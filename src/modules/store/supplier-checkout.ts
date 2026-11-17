import "server-only";
import type { PoolClient } from "pg";
import type { CartOwner } from "./cart";
import { db } from "@/lib/db";
import { importSeta } from "@/modules/suppliers/seta-import";
import { refreshDinamikItems } from "@/modules/suppliers/dinamik-import";
import { refreshBasbugItems } from "@/modules/suppliers/basbug-item-refresh";
import { fallbackReason, type FallbackReason } from "@/modules/suppliers/checkout-fallback";
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
 * import, a live answer is still used (#788): a line out of stock in every depot/region comes back in `soldOut` and a
 * line with a new cost in `repriced`; the order refuses both and names them. SETA's list import has no such case.
 */
export async function refreshCheckoutSources(owner:CartOwner) {
  const cart = await checkoutItems(owner);
  const mode = await supplierCheckoutMode();
  const unverified: Record<string,FallbackReason> = {};
  const gone: string[] = [], soldOut: string[] = [], repriced: string[] = [];
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
        gone.push(...result.gone); soldOut.push(...result.soldOut); repriced.push(...result.repriced);
      },
      // Dinamik answers per code (getStock), so only the cart's own rows are re-read: ~0.5 s per four lines
      // instead of whole brand lists (up to ~35 s), and no wait on a running nightly brand import.
      dinamik: async () => {
        const result = await refreshDinamikItems(db, ids("dinamik"));
        Object.assign(unverified, result.failed);
        gone.push(...result.gone); soldOut.push(...result.soldOut); repriced.push(...result.repriced);
      },
    });
    for (const { supplier, reason } of failures)
      for (const id of ids(supplier)) unverified[id] ??= fallbackReason(reason);
  }
  return { items: cart.map(item => item.id), mode, unverified, gone, soldOut, repriced };
}
