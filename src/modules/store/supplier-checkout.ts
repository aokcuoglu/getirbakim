import "server-only";
import type { PoolClient } from "pg";
import type { CartOwner } from "./cart";
import { db } from "@/lib/db";
import { importSeta } from "@/modules/suppliers/seta-import";
import { refreshDinamikItems } from "@/modules/suppliers/dinamik-import";
import { refreshBasbugItems } from "@/modules/suppliers/basbug-item-refresh";
import { CHECKOUT_LOCK_TIMEOUT, fallbackReason, type FallbackReason } from "@/modules/suppliers/checkout-fallback";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { catalogSql } from "./catalog";
import { supplierCheckoutMode } from "./supplier-checkout-policy";
import { refreshSuppliersConcurrently, type CheckoutSupplier } from "./supplier-checkout-refresh";

export type CheckoutItem = {id:string;supplier:CheckoutSupplier};
/** The cart's supplier lines in id order; the order transaction compares them with what was refreshed. */
export async function checkoutItems(owner:CartOwner, connection:Pick<PoolClient,"query">=db) {
  return (await connection.query<CheckoutItem>(`SELECT i.id::text AS id,i.supplier
    FROM supplier_items i JOIN commerce_cart_items c ON c.product_id=i.id
    WHERE c.owner_kind=$1 AND c.owner_id=$2 AND i.supplier IN ('basbug','seta','dinamik') ORDER BY i.id`,
    [owner.kind,owner.id])).rows;
}
/** The live-checked supplier rows among `ids` in id order (partner orders, #426, which have no cart). */
export async function checkoutItemsOf(ids:string[], connection:Pick<PoolClient,"query">=db) {
  return (await connection.query<CheckoutItem>(`SELECT id::text AS id,supplier FROM supplier_items
    WHERE id=ANY($1::uuid[]) AND supplier IN ('basbug','seta','dinamik') ORDER BY id`, [ids])).rows;
}
/**
 * Live mode re-reads the cart's supplier lines before the order. A line the supplier could not confirm comes back in
 * `unverified` with the reason: the order sells it on its saved data (only while that is still fresh) and marks it.
 * A line whose code the supplier no longer knows (Başbuğ 604, Dinamik's empty getStock) comes back in `gone`, whether
 * or not its zeroed stock could be saved, and the order refuses it (#770). When the rows stay locked by a running
 * import, a live answer is still used (#788): a line out of stock in every depot/region comes back in `soldOut` (the
 * order refuses and names it) and a line with a new cost in `recosted` (id -> live `nf`). A new cost is not a price
 * verdict: the order refuses it only if its sale price would change (#861, livePriceChanges) and otherwise sells it
 * on saved data, marked "busy". SETA's list import has no such case.
 */
export async function refreshCheckoutSources(owner:CartOwner) {
  return refreshSupplierLines(await checkoutItems(owner));
}
export type SupplierLineRefresh = Awaited<ReturnType<typeof refreshSupplierLines>>;
/**
 * refreshCheckoutSources for an explicit list of supplier lines (checkoutItems / checkoutItemsOf): the storefront's cart
 * and a partner order (#426) share the same live check, fallbacks and markers.
 */
export async function refreshSupplierLines(cart:CheckoutItem[]) {
  const mode = await supplierCheckoutMode();
  const unverified: Record<string,FallbackReason> = {};
  const gone: string[] = [], soldOut: string[] = [];
  const recosted: Record<string,number> = {};
  if (mode === "live") {
    const ids = (supplier:CheckoutSupplier) => cart.filter(item => item.supplier === supplier).map(item => item.id);
    // Verified endpoints only: SETA's list, Başbuğ's per-code MalzemeAra (16 Nov 2026) and Dinamik's per-code getStock.
    // No order transaction or product row locks are held while waiting on the supplier; suppliers run side by side (#711).
    const failures = await refreshSuppliersConcurrently(cart, {
      seta: () => importSeta(db, {mode:"commerce"}),
      // Only the cart's own codes, and no wait on a running list import's lock (#763).
      basbug: async () => {
        const result = await refreshBasbugItems(db, ids("basbug"));
        Object.assign(unverified, result.failed);
        gone.push(...result.gone); soldOut.push(...result.soldOut); Object.assign(recosted, result.recosted);
      },
      // Dinamik answers per code (getStock), so only the cart's own rows are re-read: ~0.5 s per four lines
      // instead of whole brand lists (up to ~35 s), and no wait on a running nightly brand import.
      dinamik: async () => {
        const result = await refreshDinamikItems(db, ids("dinamik"));
        Object.assign(unverified, result.failed);
        gone.push(...result.gone); soldOut.push(...result.soldOut); Object.assign(recosted, result.recosted);
      },
    });
    for (const { supplier, reason } of failures)
      for (const id of ids(supplier)) unverified[id] ??= fallbackReason(reason);
  }
  return { items: cart.map(item => item.id), mode, unverified, gone, soldOut, recosted };
}

/**
 * Locks an order's sources inside its transaction (#790): store products FOR UPDATE (their stock is reserved), supplier
 * rows FOR SHARE while prices are checked. A supplier list import updates every row in its scope and holds them until it
 * commits: the order waits at most CHECKOUT_LOCK_TIMEOUT, then goes on without the share lock and reads the rows as
 * committed before the import. The caller's quote/price check still refuses a changed price; lock_timeout is reset so
 * later writes wait normally. `label` names the order in the warning.
 */
export async function lockCheckoutSources(client:PoolClient, ids:string[], label:string) {
  await client.query("SELECT id FROM store_products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",[ids]);
  await client.query("SAVEPOINT supplier_rows");
  await client.query(CHECKOUT_LOCK_TIMEOUT);
  try {
    await client.query("SELECT id FROM supplier_items WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",[ids]);
    await client.query("RELEASE SAVEPOINT supplier_rows");
  } catch(error) {
    if((error as {code?:unknown}).code!=="55P03") throw error;
    await client.query("ROLLBACK TO SAVEPOINT supplier_rows");
    console.warn(`Order: supplier rows locked by an import, continuing with committed data (${label})`);
  }
  await client.query("SET LOCAL lock_timeout = 0");
}

/**
 * An order line's pricing snapshot with the live-check outcome (#763, #861): a line the supplier could not confirm live
 * is sold on its saved data and marked for operations; a live cost that could not be saved is recorded as live_check_nf.
 */
export function checkedLineSnapshot(snapshot:Record<string,unknown>, refreshed:Pick<SupplierLineRefresh,"unverified"|"recosted">, id:string, extra:Record<string,unknown>={}) {
  const liveNf=refreshed.recosted[id];
  const reason=refreshed.unverified[id] ?? (liveNf!==undefined ? "busy" : undefined);
  return {...snapshot,...extra,...(reason ? {checkout_mode:"snapshot",live_check:"failed",live_check_reason:reason} : {}),
    ...(liveNf!==undefined ? {live_check_nf:liveNf} : {})};
}

/** A line whose live cost could not be saved: its live `nf` (in the row's currency) and the price the order charges. */
export type LiveCost = {id:string;nf:number;price:number|null};
/**
 * The lines whose sale price would change if their live cost were saved (#861). `price` is what the order charges
 * (cartFor's price_kurus, read earlier in the same transaction): comparing with it, not with a fresh catalog read,
 * keeps a supplier pull that commits in between from making a stale price look current. The new price is recomputed
 * with the catalog's pricing_snapshot values (exchange_rate, markup_percent, vat_percent, kept exactly as numeric in
 * jsonb) by the commerce_*_price functions that commerce_catalog itself calls (db/commerce.sql, #882): an admin's
 * fixed price replaces the formula's, a campaign counts only inside its window and below the regular price, and a
 * cost the formula cannot price leaves the line unpriced (a change). The view's cost>0/exchange_rate>0/freshness
 * gates are not repeated: it is only called for lines cartFor found priced and sellable, and the refresh reports a
 * non-positive live cost as sold out. A line missing from the catalog by now counts as changed (no snapshot, so no
 * formula price), and so does a line with an open price anomaly (#1030, #1050), which the view leaves unpriced.
 * scripts/test-supplier-checkout.ts compares it with the view. Read-only, no locks.
 */
export async function livePriceChanges(connection:Pick<PoolClient,"query">, lines:LiveCost[]) {
  if (!lines.length) return [];
  return (await connection.query<{id:string}>(`WITH live AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,nf numeric,price integer)),
    line AS (
      SELECT l.id,l.price,CASE WHEN pa.supplier_item_id IS NULL THEN commerce_final_price(
        commerce_regular_price(commerce_formula_price(l.nf,(p.pricing_snapshot->>'exchange_rate')::numeric,
          (p.pricing_snapshot->>'markup_percent')::numeric,(p.pricing_snapshot->>'vat_percent')::numeric),ov.price_kurus),
        commerce_campaign_price(ov.sale_price_kurus,ov.sale_from,ov.sale_until,now())) END AS live_price
      FROM live l
      -- LATERAL + OFFSET 0 keeps the view from being planned as one catalog-wide scan per line (#705).
      LEFT JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=l.id OFFSET 0) p ON true
      LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=l.id
      LEFT JOIN supplier_price_anomalies pa ON pa.supplier_item_id=l.id AND pa.status='open')
    SELECT id::text FROM line WHERE price IS DISTINCT FROM live_price ORDER BY id`,
    [storefrontCompanies(), JSON.stringify(lines)])).rows.map(row => row.id);
}
