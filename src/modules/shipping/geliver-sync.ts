import "server-only";
import { db } from "@/lib/db";
import { applyTrackingUpdate } from "./geliver-labels";
import { geliverConfig, getShipment, type GeliverResult, type GeliverShipment } from "./geliver";
import { geliverMode, webhookEventSchema } from "./geliver-request";

// Periodic Geliver tracking sync (#974): a missed TRACK_UPDATED webhook (an event before the shipment id was stored is
// ignored as unknown_shipment; Geliver's retries are undocumented) must not leave a delivered order "shipped" forever.
// Live labels of shipped orders are fetched one by one (GET /shipments/{id}) and the reply goes through the webhook's
// own applyTrackingUpdate, so ordering, duplicate, stale and tracking-number rules stay identical. Test labels are never
// fetched: a GET advances a test shipment. Run by `npm run geliver:sync` (docs/commerce.md).

export const SYNC_DEFAULT_LIMIT = 50;
export const SYNC_DEFAULT_MIN_AGE_MINUTES = 60;
const DEFAULT_PAUSE_MS = 300;

export type GeliverSyncCandidate = { rowId: string; orderId: string; shipmentId: string; checkedAt: Date | null; trackingStatusCode: string | null };
export type GeliverSyncResult = GeliverSyncCandidate & (
  | { outcome: "applied"; statusCode: string }
  | { outcome: "ignored"; reason: "unknown_shipment" | "stale" | "duplicate" }
  /** Geliver answered without a tracking status: nothing to apply yet. */
  | { outcome: "no_status" }
  /** Refused, unanswered or unexpected reply: the row keeps everything but checked_at. */
  | { outcome: "error"; reason: string }
);
export type GeliverSyncSummary =
  | { status: "not_live" }
  | { status: "unavailable" }
  | { status: "done"; dryRun: true; candidates: GeliverSyncCandidate[] }
  | { status: "done"; dryRun: false; results: GeliverSyncResult[] };

type CandidateRow = { id: string; order_id: string; geliver_shipment_id: string; previous: Date | null; tracking_status_code: string | null };

// Purchased live labels of orders still on their way, oldest check first. A label that already says DELIVERED has
// nothing left to learn; checked_at is set by every purchase, webhook update and sync attempt.
const CANDIDATES = `SELECT s.id,s.order_id::text,s.geliver_shipment_id,s.checked_at AS previous,s.tracking_status_code
  FROM commerce_geliver_shipments s JOIN commerce_orders o ON o.id=s.order_id
  WHERE s.status='purchased' AND NOT s.test AND s.geliver_shipment_id IS NOT NULL AND o.status='shipped'
    AND s.tracking_status_code IS DISTINCT FROM 'DELIVERED'
    AND (s.checked_at IS NULL OR s.checked_at <= now()-make_interval(mins=>$1::int))
  ORDER BY s.checked_at ASC NULLS FIRST,s.completed_at,s.id LIMIT $2`;

const toCandidate = (row: CandidateRow): GeliverSyncCandidate => ({
  rowId: row.id, orderId: row.order_id, shipmentId: row.geliver_shipment_id, checkedAt: row.previous, trackingStatusCode: row.tracking_status_code,
});
const byLastCheck = (a: GeliverSyncCandidate, b: GeliverSyncCandidate) =>
  (a.checkedAt?.getTime() ?? -Infinity) - (b.checkedAt?.getTime() ?? -Infinity);

/** Takes the batch: checked_at is stamped before any call, so a parallel run skips these rows. */
async function claim(minAgeMinutes: number, limit: number) {
  const { rows } = await db.query<CandidateRow>(
    `WITH picked AS (${CANDIDATES} FOR UPDATE OF s SKIP LOCKED)
     UPDATE commerce_geliver_shipments s SET checked_at=now() FROM picked WHERE s.id=picked.id
     RETURNING s.id,picked.order_id,picked.geliver_shipment_id,picked.previous,picked.tracking_status_code`,
    [minAgeMinutes, limit],
  );
  return rows.map(toCandidate).sort(byLastCheck);
}

const describe = (result: GeliverResult<unknown>) =>
  result.kind === "rejected" ? `rejected ${result.code} (HTTP ${result.httpStatus})` : result.kind === "unknown" ? result.reason : "ok";

async function syncOne(candidate: GeliverSyncCandidate, fetchShipment: () => Promise<GeliverResult<GeliverShipment>>): Promise<GeliverSyncResult> {
  let reply: GeliverResult<GeliverShipment>;
  try { reply = await fetchShipment(); }
  catch (error) { reply = { kind: "unknown", reason: error instanceof Error ? error.message : "Geliver çağrısı tamamlanamadı.", httpStatus: null }; }
  if (reply.kind !== "ok") return { ...candidate, outcome: "error", reason: describe(reply).slice(0, 200) };
  const shipment = reply.data;
  if (shipment.id !== candidate.shipmentId) return { ...candidate, outcome: "error", reason: "another shipment in the reply" };
  if (shipment.test) return { ...candidate, outcome: "error", reason: "Geliver reports a test shipment" };
  const event = webhookEventSchema.safeParse({
    event: "TRACK_UPDATED",
    data: { id: candidate.shipmentId, test: false, trackingNumber: shipment.trackingNumber, trackingUrl: shipment.trackingUrl, trackingStatus: shipment.trackingStatus },
  });
  if (!event.success || !event.data.data.trackingStatus) return { ...candidate, outcome: "no_status" };
  const applied = await applyTrackingUpdate(event.data);
  return applied.outcome === "applied"
    ? { ...candidate, outcome: "applied", statusCode: event.data.data.trackingStatus.trackingStatusCode }
    : { ...candidate, outcome: "ignored", reason: applied.reason };
}

/**
 * Fetches up to `limit` live labels of shipped orders not checked for `minAgeMinutes` and applies their tracking status
 * like a webhook. Only with GELIVER_MODE=live. A failed call is logged (ids only) and the run goes on; database errors
 * are thrown. `dryRun` lists the labels without calling Geliver or writing.
 */
export async function syncGeliverShipments({ limit = SYNC_DEFAULT_LIMIT, minAgeMinutes = SYNC_DEFAULT_MIN_AGE_MINUTES, dryRun = false, pauseMs = DEFAULT_PAUSE_MS }: {
  limit?: number; minAgeMinutes?: number; dryRun?: boolean; pauseMs?: number;
} = {}): Promise<GeliverSyncSummary> {
  if (geliverMode(process.env) !== "live") return { status: "not_live" };
  const config = geliverConfig();
  if (!config) return { status: "unavailable" };
  if (dryRun) {
    const { rows } = await db.query<CandidateRow>(CANDIDATES, [minAgeMinutes, limit]);
    return { status: "done", dryRun: true, candidates: rows.map(toCandidate) };
  }
  const results: GeliverSyncResult[] = [];
  for (const [index, candidate] of (await claim(minAgeMinutes, limit)).entries()) {
    if (index > 0 && pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
    const result = await syncOne(candidate, () => getShipment(config, candidate.shipmentId));
    if (result.outcome === "error") console.warn("Geliver sync failed for a shipment", { rowId: result.rowId, orderId: result.orderId, reason: result.reason });
    results.push(result);
  }
  return { status: "done", dryRun: false, results };
}
