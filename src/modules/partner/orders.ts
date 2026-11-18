import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { catalogSql, type CatalogProduct } from "@/modules/store/catalog";
import { checkedLineSnapshot, checkoutItemsOf, livePriceChanges, lockCheckoutSources, refreshSupplierLines, type SupplierLineRefresh } from "@/modules/store/supplier-checkout";
import { supplierCheckoutMode } from "@/modules/store/supplier-checkout-policy";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { decodeOfferId, encodeOfferId } from "./dto";
import { partnerOrderLimitEnv, resolveOrderLimitKurus, toPartnerOrderDto, unitVatKurus, type PartnerOrderLineRow, type PartnerOrderRow } from "./order-dto";
import { addressText, type OrderRequest, type QuoteRequest } from "./order-schema";
import { partnerDiscountEnv, resolvePartnerDiscountBps, resolvePartnerPrice } from "./pricing";
import { assertQuoteMatches, fingerprintOrderRequest, PartnerOrderError, partnerQuoteSecretEnv, partnerQuoteTtlMs, quoteSecret, signQuote, verifyQuote, type QuoteLine } from "./quotes";

/**
 * Partner orders (#426): a partner (BakımX) quotes offer lines, then orders them on account. The order is a regular
 * commerce_orders row (owner_kind 'partner', owner_id = partner code, payment_status 'on_account', status 'pending'), so
 * operations confirm, procure, ship and cancel it in /yonetim/siparisler like any other order. Supplier lines get the
 * storefront's live check (refreshSupplierLines, same Başbuğ/SETA/Dinamik policy) and nothing is reserved at a supplier.
 */
type Connection = Pick<PoolClient, "query">;
type OfferRow = CatalogProduct & { id: string };
export type PartnerOrderConfig = { discountBps: number; secret: string | undefined; limitKurus: number | null; now?: () => number };

/** The deployment's partner order settings; a missing secret or limit is refused where it is needed (fail closed). */
export function partnerOrderConfig(): PartnerOrderConfig {
  return {
    discountBps: resolvePartnerDiscountBps(process.env[partnerDiscountEnv]),
    secret: process.env[partnerQuoteSecretEnv],
    limitKurus: resolveOrderLimitKurus(process.env[partnerOrderLimitEnv]),
  };
}

/** Catalog rows behind offer ids, priced like the storefront (LATERAL + OFFSET 0 per id, #705). */
async function offerRows(ids: string[], connection: Connection = db) {
  const { rows } = await connection.query<OfferRow>(`SELECT p.* FROM unnest($2::uuid[]) AS wanted(id)
    JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=wanted.id OFFSET 0) p ON true`, [storefrontCompanies(), ids]);
  return new Map(rows.map(row => [row.id, row]));
}

/** The B2B unit price (kuruş, VAT excluded) the partner pays for a sellable supplier row, null when it is not offered. */
function unitPrice(row: OfferRow | undefined, quantity: number, discountBps: number) {
  // Partners get supplier-backed parts only, like the products endpoint; quantity follows the storefront's per-line cap.
  if (!row || row.source !== "supplier" || !row.available || row.price_kurus == null || quantity > row.max_quantity) return null;
  const price = resolvePartnerPrice(row.pricing_snapshot, row.price_kurus, discountBps);
  return price.b2bPriceKurus == null ? null : { unitNetKurus: price.b2bPriceKurus, vatRateBps: price.vatRateBps, listPriceKurus: price.listPriceKurus, discountBps: price.discountBps };
}

function decodeLines<T extends { selectedOfferId: string }>(lines: T[]) {
  return lines.map(line => {
    const id = decodeOfferId(line.selectedOfferId);
    if (!id) throw new PartnerOrderError("OFFER_UNAVAILABLE", "Selected offer is unavailable.", 409, { selectedOfferIds: [line.selectedOfferId] });
    return { ...line, id };
  });
}

const unavailable = (ids: string[]) =>
  new PartnerOrderError("OFFER_UNAVAILABLE", "Selected offers are unavailable.", 409, { selectedOfferIds: [...new Set(ids)].map(encodeOfferId) });

/** Every line with its row and price; OFFER_UNAVAILABLE naming the lines that cannot be sold. */
function priceLines<T extends { id: string; quantity: number }>(lines: T[], rows: Map<string, OfferRow>, discountBps: number) {
  const priced = lines.map(line => {
    const row = rows.get(line.id);
    return { line, row, price: unitPrice(row, line.quantity, discountBps) };
  });
  const sellable = priced.flatMap(({ line, row, price }) => row && price ? [{ line, row, price }] : []);
  if (sellable.length !== priced.length) throw unavailable(priced.filter(item => !item.price).map(item => item.line.id));
  return sellable;
}

const unitAmounts = (unitNetKurus: number, vatRateBps: number) => {
  const unitVat = unitVatKurus(unitNetKurus, vatRateBps);
  return { unitNetKurus, unitVatKurus: unitVat, unitGrossKurus: unitNetKurus + unitVat, vatRateBps };
};

/** A binding quote for the lines on saved supplier data; the order re-checks it live. Nothing is reserved. */
export async function quotePartnerOrder(partner: string, request: QuoteRequest, config: PartnerOrderConfig) {
  const now = (config.now ?? Date.now)();
  // Fails closed before any database work when the signing secret is missing.
  quoteSecret(config.secret);
  const lines = decodeLines(request.lines);
  const priced = priceLines(lines, await offerRows(lines.map(line => line.id)), config.discountBps);
  const quoted = priced.map(({ line, price }) => ({ selectedOfferId: line.selectedOfferId, quantity: line.quantity, ...unitAmounts(price.unitNetKurus, price.vatRateBps) }));
  const expiresAt = now + partnerQuoteTtlMs;
  const confirmationToken = signQuote({
    version: 1, partner, issuedAt: now, expiresAt,
    lines: quoted.map(line => ({ selectedOfferId: line.selectedOfferId, quantity: line.quantity, unitNetKurus: line.unitNetKurus })),
  }, config.secret);
  const total = (key: "unitNetKurus" | "unitVatKurus" | "unitGrossKurus") => quoted.reduce((sum, line) => sum + line[key] * line.quantity, 0);
  return {
    contractVersion: "2.0" as const,
    lines: quoted,
    totals: { netKurus: total("unitNetKurus"), vatKurus: total("unitVatKurus"), shippingKurus: 0, grossKurus: total("unitGrossKurus") },
    currency: "TRY" as const,
    expiresAt: new Date(expiresAt).toISOString(),
    confirmationToken,
  };
}

const orderColumns = `id::text,number::text,request_key::text,status,payment_status,total_kurus::text,shipping_kurus::text,note,customer_name,phone,email,
  delivery_province,delivery_district,delivery_address_line,delivery_postal_code,carrier,carrier_name,tracking_no,tracking_url,
  shipped_at,delivered_at,cancelled_by,cancelled_at,created_at`;

/** One of the partner's own orders as the contract DTO; another partner's (or a store) order is not found. */
async function readOrder(partner: string, where: "id" | "request_key", value: string, connection: Connection = db) {
  const order = (await connection.query<PartnerOrderRow & { partner_fingerprint: string | null }>(
    `SELECT ${orderColumns},partner_fingerprint FROM commerce_orders WHERE owner_kind='partner' AND owner_id=$1 AND ${where === "id" ? "id" : "request_key"}=$2::uuid`,
    [partner, value])).rows[0];
  if (!order) return null;
  const lines = (await connection.query<PartnerOrderLineRow>(
    "SELECT product_id::text,code,name,quantity,unit_price_kurus::text,pricing_snapshot FROM commerce_order_items WHERE order_id=$1 ORDER BY code,product_id",
    [order.id])).rows;
  return { dto: toPartnerOrderDto(order, lines), fingerprint: order.partner_fingerprint };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new PartnerOrderError("ORDER_NOT_FOUND", "Order not found.", 404);

export async function getPartnerOrder(partner: string, id: string) {
  const found = uuidPattern.test(id) ? await readOrder(partner, "id", id) : null;
  if (!found) throw notFound();
  return found.dto;
}

export async function getPartnerOrderByKey(partner: string, key: string) {
  const found = uuidPattern.test(key) ? await readOrder(partner, "request_key", key) : null;
  if (!found) throw notFound();
  return found.dto;
}

/** The order an Idempotency-Key already created: the same body replays it, another body is a conflict. */
function replay(found: NonNullable<Awaited<ReturnType<typeof readOrder>>>, fingerprint: string) {
  if (found.fingerprint !== fingerprint) throw new PartnerOrderError("IDEMPOTENCY_CONFLICT", "The Idempotency-Key was used for another request.", 409);
  return { order: found.dto, replayed: true };
}

/**
 * Places a partner order on account. Checked in this order: idempotent replay, configuration (limit, quote secret),
 * the signed quote (partner, lines, expiry), the live supplier check, then in one transaction under the partner's lock:
 * availability, prices against the quote, the open-order limit, and the insert.
 */
export async function createPartnerOrder(partner: string, idempotencyKey: string, request: OrderRequest, config: PartnerOrderConfig) {
  const fingerprint = fingerprintOrderRequest(request);
  // Completed retries are answered without the quote, the limit or a supplier call.
  const previous = await readOrder(partner, "request_key", idempotencyKey);
  if (previous) return replay(previous, fingerprint);
  if (config.limitKurus == null) throw new PartnerOrderError("ORDER_LIMIT_UNAVAILABLE", "Partner ordering is not configured.", 503);
  const quote = verifyQuote(request.confirmationToken, config.secret);
  const requested: QuoteLine[] = request.lines.map(line => ({ selectedOfferId: line.selectedOfferId, quantity: line.quantity, unitNetKurus: line.expectedUnitNetKurus }));
  assertQuoteMatches(quote, partner, requested, (config.now ?? Date.now)());
  const lines = decodeLines(request.lines);
  const ids = lines.map(line => line.id);

  // Live supplier check outside the transaction, like the storefront (#711): no locks are held while suppliers answer.
  let refreshed: SupplierLineRefresh;
  try { refreshed = await refreshSupplierLines(await checkoutItemsOf(ids)); }
  catch { throw new PartnerOrderError("SUPPLIER_CHECK_UNAVAILABLE", "Supplier availability could not be checked; retry shortly.", 503); }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // One order at a time per partner: the open-order limit and the Idempotency-Key check see every earlier order.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`partner_order:${partner}`]);
    const existing = await readOrder(partner, "request_key", idempotencyKey, client);
    if (existing) { await client.query("COMMIT"); return replay(existing, fingerprint); }
    // (#770, #788) The supplier no longer knows the code, or the live answer said sold out: refused and named.
    const gone = [...refreshed.gone, ...refreshed.soldOut].filter(id => ids.includes(id));
    if (gone.length) throw unavailable(gone);
    await client.query("SELECT id FROM commerce_settings FOR SHARE");
    if (await supplierCheckoutMode(client) !== refreshed.mode) throw new PartnerOrderError("QUOTE_CHANGED", "Checkout rules changed; request a new quote.", 409);
    await lockCheckoutSources(client, ids, `partner ${partner}, request ${idempotencyKey}`);
    const priced = priceLines(lines, await offerRows(ids, client), config.discountBps);
    // (#861) A live cost the locked rows kept from being saved: refused only if the sale price would change. Its new
    // price is not known yet, so it is reported as null (request a new quote shortly).
    const repriced = new Set(await livePriceChanges(client, priced.flatMap(({ line, row }) =>
      refreshed.recosted[line.id] === undefined ? [] : [{ id: line.id, nf: refreshed.recosted[line.id], price: row.price_kurus }])));
    const changes = priced.filter(({ line, price }) => repriced.has(line.id) || price.unitNetKurus !== line.expectedUnitNetKurus)
      .map(({ line, price }) => ({ selectedOfferId: line.selectedOfferId, expectedUnitNetKurus: line.expectedUnitNetKurus, unitNetKurus: repriced.has(line.id) ? null : price.unitNetKurus }));
    if (changes.length) throw new PartnerOrderError("PRICE_CHANGED", "Prices changed since the quote; request a new quote.", 409, { lines: changes });

    const amounts = priced.map(({ price }) => unitAmounts(price.unitNetKurus, price.vatRateBps));
    const totalKurus = amounts.reduce((sum, amount, index) => sum + amount.unitGrossKurus * lines[index].quantity, 0);
    const open = Number((await client.query<{ open: string }>(`SELECT COALESCE(sum(total_kurus),0)::text AS open FROM commerce_orders
      WHERE owner_kind='partner' AND owner_id=$1 AND status NOT IN ('cancelled','delivered')`, [partner])).rows[0].open);
    if (open + totalKurus > config.limitKurus) {
      throw new PartnerOrderError("CREDIT_LIMIT_EXCEEDED", "The order would exceed the open-order limit.", 409,
        { limitKurus: config.limitKurus, openKurus: open, orderKurus: totalKurus });
    }

    const address = request.shippingAddress;
    // Shipping is not charged on partner orders yet (agreed with the partner outside the order); invoice details are
    // the partner's, so the order's invoice columns stay empty. No consumer pre-contract documents: a B2B sale.
    const order = (await client.query<{ id: string }>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,partner_fingerprint,customer_name,email,phone,address,note,
      total_kurus,subtotal_kurus,shipping_kurus,discount_percent,status,payment_status,delivery_province,delivery_district,delivery_address_line,delivery_postal_code)
      VALUES('partner',$1,$2,$3,$4,$5,$6,$7,$8,$9,$9,0,0,'pending','on_account',$10,$11,$12,$13) RETURNING id::text`,
    [partner, idempotencyKey, fingerprint, address.recipientName, address.email, address.phone, addressText(address), request.note, totalKurus,
      address.province, address.district, address.addressLine, address.postalCode])).rows[0];
    for (const [index, { line, row, price }] of priced.entries()) {
      const amount = amounts[index];
      const snapshot = checkedLineSnapshot(row.pricing_snapshot, refreshed, line.id, {
        partner: { code: partner, unit_net_kurus: amount.unitNetKurus, unit_vat_kurus: amount.unitVatKurus, vat_rate_bps: amount.vatRateBps,
          list_price_kurus: price.listPriceKurus, discount_bps: price.discountBps, quote_issued_at: new Date(quote.issuedAt).toISOString() },
      });
      // Supplier lines only: nothing is reserved (reserved_quantity 0), operations order it from the supplier.
      await client.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot,vehicle,fitment_level,reserved_quantity)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,'no_vehicle',0)`, [order.id, line.id, row.code, row.name, row.supplier, line.quantity, amount.unitGrossKurus, JSON.stringify(snapshot)]);
    }
    const created = await readOrder(partner, "id", order.id, client);
    if (!created) throw new Error(`Partner order ${order.id} is missing in its own transaction`);
    await client.query("COMMIT");
    return { order: created.dto, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
