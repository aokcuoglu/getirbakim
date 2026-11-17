import "server-only";
import type { PoolClient } from "pg";
import type { CartOwner } from "./cart";
import { db } from "@/lib/db";
import { importSeta } from "@/modules/suppliers/seta-import";
import { refreshDinamikItems } from "@/modules/suppliers/dinamik-import";
import { refreshBasbugItems } from "@/modules/suppliers/basbug-item-refresh";
import { fallbackReason, type FallbackReason } from "@/modules/suppliers/checkout-fallback";
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
  const cart = await checkoutItems(owner);
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
 * The lines whose sale price would change if their live cost (`costs`: id -> live `nf`, in the row's currency) were
 * saved (#861). The price is recomputed with the values the catalog used for the current one (pricing_snapshot's
 * exchange_rate, markup_percent and vat_percent, kept exactly as numeric in jsonb), in SQL so it rounds like the view.
 * `line`/`regular` and the final CASE copy the `priced`, `sold` and `final` CTEs of commerce_catalog (db/commerce.sql):
 * an admin's fixed price replaces the formula's, a campaign counts only below the regular price, and a cost the
 * formula cannot price leaves the line unpriced (a change). Keep both copies the same; scripts/test-supplier-checkout.ts
 * compares them. Read-only, no locks.
 */
export async function livePriceChanges(connection:Pick<PoolClient,"query">, costs:Record<string,number>) {
  const live = Object.entries(costs).map(([id, nf]) => ({ id, nf }));
  if (!live.length) return [];
  return (await connection.query<{id:string}>(`WITH live AS (SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,nf numeric)),
    line AS (
      SELECT l.id,p.price_kurus,ov.price_kurus AS fixed,
        CASE WHEN (ov.sale_from IS NULL OR ov.sale_from<=now()) AND (ov.sale_until IS NULL OR now()<ov.sale_until) THEN ov.sale_price_kurus END AS sale,
        round(l.nf*(p.pricing_snapshot->>'exchange_rate')::numeric*(1+(p.pricing_snapshot->>'markup_percent')::numeric/100)
          *(1+(p.pricing_snapshot->>'vat_percent')::numeric/100)*100) AS auto
      FROM live l
      -- LATERAL + OFFSET 0 keeps the view from being planned as one catalog-wide scan per line (#705).
      JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=l.id OFFSET 0) p ON true
      LEFT JOIN commerce_item_overrides ov ON ov.supplier_item_id=l.id),
    regular AS (SELECT id,price_kurus,sale,CASE WHEN auto BETWEEN 1 AND 2147483647 THEN COALESCE(fixed,auto) END AS regular FROM line)
    SELECT id::text FROM regular
    WHERE price_kurus IS DISTINCT FROM CASE WHEN sale<regular THEN sale ELSE regular END ORDER BY id`,
    [storefrontCompanies(), JSON.stringify(live)])).rows.map(row => row.id);
}
