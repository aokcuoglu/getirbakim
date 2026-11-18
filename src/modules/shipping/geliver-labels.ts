import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { appendNote } from "@/modules/payments/checkout";
import {
  buildTransactionBody, localErrorCodes, eventClock, geliverErrorMessage, geliverOrderNumber, geliverTestBlocked, geliverTestBlockedMessage, parseTime, recipientBlockLabel,
  recipientOf, resolveGeliverTrackingUrl, carriesNewData, isRepeatEvent, serviceCodeFor, shouldApply, statusTime, webhookEventSchema, webhookSecretValid, type RecipientOrder, type WebhookEvent,
} from "./geliver-request";
import type { Parcel } from "./geliver-parcel";
import { findShipmentsByOrderNumber, geliverConfig, purchaseLabel, type GeliverResult, type GeliverShipment } from "./geliver";

// Yurtiçi labels bought through Geliver from /yonetim (#960). Callers check the admin session. Every purchase has its own
// commerce_geliver_shipments row, committed as 'requested' before the call, so a lost reply is never forgotten and never
// leads to a second (paid) label: until "Geliver'de kontrol et" settles it, the order takes no new label.

export type GeliverLabelOutcome = {
  outcome: "purchased" | "failed" | "unknown" | "busy" | "not_allowed" | "unavailable" | "purchased_order_changed";
  message?: string;
  /** The order's number, for purchased_order_changed (the label to cancel in Geliver). */
  orderNumber?: string;
};

// A search right after the call may not list the shipment yet.
const CHECK_AFTER_MINUTES = 1;
// No shipment in Geliver's list proves nothing was bought only after this long (its list may lag behind the call).
const NOTHING_FOUND_AFTER_MINUTES = 5;
// A shipment without a label (offers only) may still get one shortly after the call; after this long it will not.
const NO_LABEL_AFTER_MINUTES = 10;
// Shipment states before a label is bought (statusCode): such a shipment proves no purchase.
const LABEL_LESS_STATES = new Set(["CREATED", "GOT_OFFERS", "OFFER_ACCEPTED"]);
// Geliver's clock may run slightly behind ours.
const CLOCK_SKEW_MS = 60_000;

type LabelOrder = RecipientOrder & { id: string; number: string; status: string; payment_status: string; total_kurus: string };
type Settlement =
  | { status: "purchased"; shipment: GeliverShipment; transactionId: string | null; note?: string }
  | { status: "failed" | "unknown"; errorCode?: string | null; errorMessage: string };

const lockOrder = async (client: PoolClient, orderId: string) => (await client.query<LabelOrder>(
  `SELECT id,number::text,status,payment_status,total_kurus::text,customer_name,email,phone,delivery_province,delivery_district,delivery_address_line
   FROM commerce_orders WHERE id=$1 FOR UPDATE`, [orderId],
)).rows[0];

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23505";
const shippable = (order: Pick<LabelOrder, "status" | "payment_status"> | undefined) =>
  Boolean(order && order.status === "confirmed" && ["paid", "none"].includes(order.payment_status));

const unavailable: GeliverLabelOutcome = { outcome: "unavailable", message: "Geliver ayarları eksik; Geliver'e istek gönderilmedi. Elle sevk hâlâ kullanılabilir." };
const unknownMessage = "Geliver yanıtı alınamadı; etiket alınmış olabilir. Bir dakika sonra \"Geliver'de kontrol et\" ile sonucu alın.";

function settlementOf(result: GeliverResult<{ id: string; shipment: GeliverShipment }>): Settlement {
  if (result.kind === "ok") return { status: "purchased", shipment: result.data.shipment, transactionId: result.data.id };
  if (result.kind === "rejected") return { status: "failed", errorCode: result.code, errorMessage: result.message };
  return { status: "unknown", errorMessage: result.reason };
}

/** Records the outcome on a row still in `from`; false when another request settled it first. */
async function settleRow(client: PoolClient, rowId: string, from: string[], settlement: Settlement) {
  const shipment = settlement.status === "purchased" ? settlement.shipment : null;
  const status = shipment?.trackingStatus ?? null;
  const updated = await client.query(
    `UPDATE commerce_geliver_shipments SET status=$3,geliver_shipment_id=COALESCE($4,geliver_shipment_id),geliver_transaction_id=COALESCE($5,geliver_transaction_id),
     barcode=COALESCE($6,barcode),label_url=COALESCE($7,label_url),tracking_number=COALESCE($8,tracking_number),tracking_url=COALESCE($9,tracking_url),
     tracking_status_code=COALESCE($10,tracking_status_code),tracking_sub_status_code=COALESCE($11,tracking_sub_status_code),
     tracking_status_details=COALESCE($12,tracking_status_details),tracking_location=COALESCE($13,tracking_location),
     tracking_status_at=COALESCE($14::timestamptz,tracking_status_at),tracking_updated_at=COALESCE($17::timestamptz,tracking_updated_at),error_code=$15,error_message=$16,
     completed_at=CASE WHEN $3 IN ('purchased','failed') THEN now() ELSE completed_at END,checked_at=now()
     WHERE id=$1 AND status=ANY($2::text[])`,
    [rowId, from, settlement.status, shipment?.id ?? null, settlement.status === "purchased" ? settlement.transactionId : null,
      shipment?.barcode || null, shipment?.labelURL || null, shipment?.trackingNumber || null, shipment?.trackingUrl || null,
      status?.trackingStatusCode || null, status?.trackingSubStatusCode || null, status?.statusDetails || null, status?.locationName || null,
      parseTime(status?.statusDate) ?? parseTime(status?.updatedAt),
      settlement.status === "purchased" ? null : settlement.errorCode ?? null, settlement.status === "purchased" ? null : settlement.errorMessage.slice(0, 500),
      parseTime(status?.updatedAt) ?? parseTime(status?.createdAt)],
  );
  return Boolean(updated.rowCount);
}

/**
 * After a label is bought: a still confirmed order is shipped with Yurtiçi (the tracking number usually comes later by
 * webhook); an order that changed meanwhile (cancelled) is only noted, the label must then be cancelled in Geliver.
 */
async function shipAfterPurchase(client: PoolClient, order: LabelOrder | undefined, test: boolean, shipment: GeliverShipment): Promise<GeliverLabelOutcome> {
  if (!order) return { outcome: "purchased_order_changed" };
  if (!shippable(order)) {
    await appendNote(client, order.id, `Geliver etiketi alındı (barkod ${shipment.barcode ?? "yok"}) ama sipariş durumu değişmişti; etiketi Geliver panelinden iptal edin.`);
    return { outcome: "purchased_order_changed", orderNumber: order.number,
      message: "Geliver etiketi alındı ama sipariş bu arada değişti; etiketi Geliver panelinden iptal edin." };
  }
  const trackingNo = shipment.trackingNumber || null;
  await client.query("UPDATE commerce_orders SET status='shipped',shipped_at=now(),carrier='yurtici',carrier_name=NULL,tracking_no=$2,tracking_url=$3 WHERE id=$1",
    [order.id, trackingNo, resolveGeliverTrackingUrl({ test, shipmentId: shipment.id, trackingNumber: trackingNo, trackingUrl: shipment.trackingUrl })]);
  return { outcome: "purchased" };
}

/** Ids only: never the request body (customer data) or the token. */
function logUncertain(message: string, context: { orderId: string; rowId: string; error?: unknown }) {
  const { error, ...ids } = context;
  console.error(message, { ...ids, error: error instanceof Error ? error.message : error });
}

/**
 * Buys one Yurtiçi label (a free Geliver test label unless GELIVER_MODE=live) for a confirmed order with exactly one
 * Geliver call. A concurrent or unresolved request for the same order returns `busy`.
 */
export async function createGeliverLabel({ orderId, parcel, adminId }: { orderId: string; parcel: Parcel; adminId: string }): Promise<GeliverLabelOutcome> {
  const config = geliverConfig();
  if (!config) return unavailable;
  if (geliverTestBlocked(process.env)) return { outcome: "unavailable", message: geliverTestBlockedMessage };
  const test = config.mode !== "live";
  type Claim = { row: { id: string }; body: ReturnType<typeof buildTransactionBody> };
  let claim: Claim | GeliverLabelOutcome;
  try {
    claim = await inTransaction(async (client): Promise<Claim | GeliverLabelOutcome> => {
      const order = await lockOrder(client, orderId);
      if (!order || !shippable(order)) return { outcome: "not_allowed", message: "Sipariş kargoya verilecek durumda değil. Listeyi yenileyin." };
      const recipient = recipientOf(order);
      if (!recipient.ok) return { outcome: "not_allowed", message: recipientBlockLabel[recipient.reason] };
      const active = (await client.query<{ status: string }>(
        "SELECT status FROM commerce_geliver_shipments WHERE order_id=$1 AND status IN ('requested','unknown','purchased')", [orderId],
      )).rows[0];
      if (active?.status === "purchased") return { outcome: "not_allowed", message: "Bu sipariş için Geliver etiketi zaten alınmış." };
      if (active) return { outcome: "busy", message: "Önceki etiket isteğinin sonucu bekleniyor. \"Geliver'de kontrol et\" ile sonucu alın." };
      const lines = (await client.query<{ name: string; quantity: number }>(
        "SELECT name,quantity FROM commerce_order_items WHERE order_id=$1 ORDER BY code,product_id", [orderId],
      )).rows;
      const body = buildTransactionBody({ order, recipient: recipient.address, lines, parcel, mode: config.mode, siteUrl });
      const row = (await client.query<{ id: string }>(
        `INSERT INTO commerce_geliver_shipments(order_id,test,service_code,order_number,parcel,requested_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
        [orderId, test, serviceCodeFor(config.mode), geliverOrderNumber(order.number, test), JSON.stringify(parcel), adminId],
      )).rows[0];
      return { row, body };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "busy", message: "Bu sipariş için başka bir Geliver isteği sürüyor." };
    throw error;
  }
  if (!("row" in claim)) return claim;

  const { row, body } = claim;
  let result: GeliverResult<{ id: string; shipment: GeliverShipment }>;
  try { result = await purchaseLabel(config, body); }
  catch (error) { result = { kind: "unknown", reason: error instanceof Error ? error.message : "Geliver çağrısı tamamlanamadı.", httpStatus: null }; }
  const settlement = settlementOf(result);
  if (settlement.status === "unknown") logUncertain("Geliver label outcome unknown", { orderId, rowId: row.id, error: settlement.errorMessage });
  try {
    return await inTransaction(async (client): Promise<GeliverLabelOutcome> => {
      const order = await lockOrder(client, orderId);
      if (!await settleRow(client, row.id, ["requested"], settlement)) return { outcome: "unknown", message: unknownMessage };
      if (settlement.status === "purchased") return shipAfterPurchase(client, order, test, settlement.shipment);
      if (settlement.status === "failed") return { outcome: "failed", message: geliverErrorMessage(settlement.errorCode ?? null, settlement.errorMessage) };
      return { outcome: "unknown", message: unknownMessage };
    });
  } catch (error) {
    // The row stays 'requested', which blocks new labels until "Geliver'de kontrol et" settles it.
    logUncertain("Geliver label result could not be recorded", { orderId, rowId: row.id, error });
    return { outcome: "unknown", message: unknownMessage };
  }
}

type OpenRow = { id: string; order_id: string; status: string; test: boolean; order_number: string; requested_at: Date };

/**
 * Settles a requested/unknown label request from Geliver's shipment list for its order number: a shipment of the same
 * test/live kind created after the request makes it purchased (and ships the order); none makes it failed (a new label
 * may be bought). An unanswered search keeps it unknown.
 */
export async function checkGeliverLabel({ shipmentRowId, orderId }: { shipmentRowId: string; orderId: string }): Promise<GeliverLabelOutcome> {
  const config = geliverConfig();
  if (!config) return unavailable;
  const row = (await db.query<OpenRow>(
    "SELECT id,order_id,status,test,order_number,requested_at FROM commerce_geliver_shipments WHERE id=$1 AND order_id=$2", [shipmentRowId, orderId],
  )).rows[0];
  if (!row || !["requested", "unknown"].includes(row.status)) return { outcome: "not_allowed", message: "Bu etiket isteği zaten sonuçlanmış. Listeyi yenileyin." };
  if (Date.now() - row.requested_at.getTime() < CHECK_AFTER_MINUTES * 60_000) {
    return { outcome: "unknown", message: "İstek çok yeni; bir dakika sonra yeniden kontrol edin." };
  }
  let settlement: Settlement;
  try {
    const found = await findShipmentsByOrderNumber(config, row.order_number);
    if (found.kind !== "ok") {
      settlement = { status: "unknown", errorMessage: found.kind === "rejected" ? `Geliver sorgusu reddedildi (${found.code}): ${found.message}` : found.reason };
    } else {
      const from = row.requested_at.getTime() - CLOCK_SKEW_MS;
      const ageMinutes = (Date.now() - row.requested_at.getTime()) / 60_000;
      const candidates = found.data.filter(s => (s.test ?? false) === row.test && (!s.order?.orderNumber || s.order.orderNumber === row.order_number)
        && s.statusCode !== "CANCELED" && (parseTime(s.createdAt)?.getTime() ?? -Infinity) >= from);
      // Only a shipment with a label proves a purchase. The list carries the label, barcode and tracking status; a
      // detail request would advance a test shipment.
      const labelled = candidates.filter(s => (s.labelURL || s.barcode) && !LABEL_LESS_STATES.has(s.statusCode ?? ""));
      if (labelled.length) {
        settlement = { status: "purchased", shipment: labelled[0], transactionId: null,
          note: labelled.length > 1 ? `Geliver'de #${row.order_number} için ${labelled.length} etiketli gönderi var; fazlasını Geliver panelinden iptal edin.` : undefined };
      } else if (candidates.length) {
        settlement = ageMinutes >= NO_LABEL_AFTER_MINUTES
          ? { status: "failed", errorCode: localErrorCodes.noLabel, errorMessage: "Geliver'de etiketi alınmamış bir gönderi var; Geliver panelini kontrol edin." }
          : { status: "unknown", errorMessage: "Geliver'de gönderi var ama etiketi henüz görünmüyor; biraz sonra yeniden kontrol edin." };
      } else {
        settlement = ageMinutes >= NOTHING_FOUND_AFTER_MINUTES
          ? { status: "failed", errorCode: localErrorCodes.notFound, errorMessage: "Geliver'de gönderi oluşmamış; yeniden deneyebilirsiniz." }
          : { status: "unknown", errorMessage: "Geliver'de gönderi henüz görünmüyor; birkaç dakika sonra yeniden kontrol edin." };
      }
    }
  } catch (error) {
    settlement = { status: "unknown", errorMessage: `Geliver sorgusu yanıt vermedi: ${error instanceof Error ? error.message : "bilinmeyen hata"}`.slice(0, 500) };
  }
  if (settlement.status === "unknown") logUncertain("Geliver label still unknown after search", { orderId, rowId: row.id, error: settlement.errorMessage });
  return inTransaction(async (client): Promise<GeliverLabelOutcome> => {
    const order = await lockOrder(client, orderId);
    if (!await settleRow(client, row.id, ["requested", "unknown"], settlement)) return { outcome: "busy", message: "Bu istek başka bir işlemle sonuçlandı. Listeyi yenileyin." };
    if (settlement.status === "purchased") {
      if (settlement.note && order) await appendNote(client, order.id, settlement.note);
      return shipAfterPurchase(client, order, row.test, settlement.shipment);
    }
    if (settlement.status === "failed") return { outcome: "failed", message: settlement.errorMessage };
    return { outcome: "unknown", message: settlement.errorMessage };
  });
}

type TrackedRow = {
  id: string; order_id: string; test: boolean; geliver_shipment_id: string; tracking_number: string | null; tracking_url: string | null;
  tracking_status_code: string | null; tracking_sub_status_code: string | null; tracking_updated_at: Date | null;
  tracking_status_details: string | null; tracking_location: string | null;
};
export type TrackingUpdateResult = { outcome: "applied"; orderId: string } | { outcome: "ignored"; reason: "unknown_shipment" | "stale" | "duplicate" };

/**
 * Applies a TRACK_UPDATED event to its label and order: tracking fields, the tracking number when the order has none,
 * the tracking link while it is still the one derived from Geliver, and DELIVERED → delivered. Returns, failures or
 * cancellations are shown on the label only; operations decide what happens to the order.
 */
export async function applyTrackingUpdate(event: WebhookEvent): Promise<TrackingUpdateResult> {
  const known = (await db.query<{ order_id: string }>(
    "SELECT order_id FROM commerce_geliver_shipments WHERE geliver_shipment_id=$1", [event.data.id],
  )).rows[0];
  if (!known) return { outcome: "ignored", reason: "unknown_shipment" };
  return inTransaction(async (client): Promise<TrackingUpdateResult> => {
    const order = (await client.query<{ id: string; status: string; tracking_no: string | null; tracking_url: string | null }>(
      "SELECT id,status,tracking_no,tracking_url FROM commerce_orders WHERE id=$1 FOR UPDATE", [known.order_id],
    )).rows[0];
    const row = (await client.query<TrackedRow>(
      `SELECT id,order_id,test,geliver_shipment_id,tracking_number,tracking_url,tracking_status_code,tracking_sub_status_code,tracking_updated_at,tracking_status_details,tracking_location
       FROM commerce_geliver_shipments WHERE geliver_shipment_id=$1 FOR UPDATE`, [event.data.id],
    )).rows[0];
    if (!row || !order) return { outcome: "ignored", reason: "stale" };
    const status = event.data.trackingStatus!;
    // A delivery of an order still on its way is never stale, whatever the clocks say.
    const delivers = status.trackingStatusCode === "DELIVERED" && order.status === "shipped";
    const repeat = isRepeatEvent(row, event);
    // A repeat of the status that brings a new number, link, detail or location is still written.
    if (!delivers && !shouldApply(row, event) && !(repeat && carriesNewData(row, event))) return { outcome: "ignored", reason: repeat ? "duplicate" : "stale" };
    const clock = eventClock(event), carrierTime = statusTime(event);
    const trackingNumber = event.data.trackingNumber || row.tracking_number;
    const trackingUrl = event.data.trackingUrl || row.tracking_url;
    await client.query(
      `UPDATE commerce_geliver_shipments SET tracking_number=$2,tracking_url=$3,tracking_status_code=$4,tracking_sub_status_code=$5,
       tracking_status_details=$6,tracking_location=$7,tracking_status_at=$8,
       tracking_updated_at=CASE WHEN $9::timestamptz IS NULL THEN tracking_updated_at ELSE GREATEST(tracking_updated_at,$9::timestamptz) END,checked_at=now() WHERE id=$1`,
      [row.id, trackingNumber, trackingUrl, status.trackingStatusCode, status.trackingSubStatusCode || null, status.statusDetails || null,
        status.locationName || null, carrierTime ?? clock, clock],
    );
    if (["shipped", "delivered"].includes(order.status)) {
      const previous = resolveGeliverTrackingUrl({ test: row.test, shipmentId: row.geliver_shipment_id, trackingNumber: row.tracking_number, trackingUrl: row.tracking_url });
      const next = resolveGeliverTrackingUrl({ test: row.test, shipmentId: row.geliver_shipment_id, trackingNumber, trackingUrl });
      // A number or link entered by hand ("Kargo bilgisini düzenle") stays.
      await client.query(`UPDATE commerce_orders SET tracking_no=COALESCE(tracking_no,$2),
        tracking_url=CASE WHEN tracking_url IS NULL OR tracking_url=$3 THEN $4 ELSE tracking_url END WHERE id=$1`,
      [order.id, trackingNumber, previous, next]);
    }
    if (delivers) {
      // The carrier's delivery time, kept between the shipping time and now; without it, now.
      await client.query(`UPDATE commerce_orders SET status='delivered',
        delivered_at=CASE WHEN $2::timestamptz IS NULL THEN now() ELSE LEAST(now(),GREATEST(shipped_at,$2::timestamptz)) END WHERE id=$1 AND status='shipped'`,
      [order.id, carrierTime]);
    }
    return { outcome: "applied", orderId: order.id };
  });
}

export type WebhookResponse =
  | { status: 401 }
  | { status: 200; outcome: "ignored"; reason: "not_track_updated" | "invalid_body" | "unknown_shipment" | "stale" | "duplicate"; via: "header" | "token" }
  | { status: 200; outcome: "applied"; orderId: string; via: "header" | "token" };

/**
 * The Geliver webhook (POST /api/shipping/geliver/webhook). The secret (GELIVER_WEBHOOK_SECRET) arrives in the
 * X-Geliver-Secret header or the `token` query parameter. A verified body is trusted as is: asking Geliver back would
 * advance a test shipment. Anything that is not a usable TRACK_UPDATED is acknowledged and ignored, so Geliver does not
 * retry it; the body is never logged (it holds the customer's address).
 */
export async function handleGeliverWebhook({ header, token, rawBody }: { header: string | null; token: string | null; rawBody: string }): Promise<WebhookResponse> {
  const via = authenticateGeliverWebhook({ header, token });
  if (!via) return { status: 401 };
  return handleAuthenticatedWebhook(via, rawBody);
}

/** Which carrier of GELIVER_WEBHOOK_SECRET matched; checked before the body is read. */
export const authenticateGeliverWebhook = ({ header, token }: { header: string | null; token: string | null }) =>
  webhookSecretValid({ secret: process.env.GELIVER_WEBHOOK_SECRET, header, token });

/** The body of a webhook whose secret was already checked (authenticateGeliverWebhook). */
export async function handleAuthenticatedWebhook(via: "header" | "token", rawBody: string): Promise<Exclude<WebhookResponse, { status: 401 }>> {
  let json: unknown;
  try { json = JSON.parse(rawBody); }
  catch { json = null; }
  const parsed = webhookEventSchema.safeParse(json);
  if (!parsed.success || !parsed.data.data.trackingStatus) {
    console.warn("Geliver webhook ignored", { via, reason: "invalid_body" });
    return { status: 200, outcome: "ignored", reason: "invalid_body", via };
  }
  if (parsed.data.event !== "TRACK_UPDATED") {
    console.warn("Geliver webhook ignored", { via, reason: "not_track_updated", event: parsed.data.event.slice(0, 40) });
    return { status: 200, outcome: "ignored", reason: "not_track_updated", via };
  }
  const result = await applyTrackingUpdate(parsed.data);
  if (result.outcome === "ignored") {
    console.warn("Geliver webhook ignored", { via, reason: result.reason, shipmentId: parsed.data.data.id.slice(0, 64) });
    return { status: 200, outcome: "ignored", reason: result.reason, via };
  }
  console.info("Geliver webhook applied", { via, orderId: result.orderId, status: parsed.data.data.trackingStatus.trackingStatusCode });
  return { status: 200, outcome: "applied", orderId: result.orderId, via };
}
