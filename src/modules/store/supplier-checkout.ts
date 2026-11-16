import "server-only";
import type { PoolClient } from "pg";
import type { CartOwner } from "./cart";
import { db } from "@/lib/db";
import { importSeta } from "@/modules/suppliers/seta-import";
import { refreshDinamikItems } from "@/modules/suppliers/dinamik-import";
import { fallbackReason, refreshBasbugItems, type FallbackReason } from "@/modules/suppliers/basbug-item-refresh";
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
 */
export async function refreshCheckoutSources(owner:CartOwner) {
  const cart = await checkoutItems(owner);
  const mode = await supplierCheckoutMode();
  const unverified: Record<string,FallbackReason> = {};
  if (mode === "live") {
    const ids = (supplier:CheckoutSupplier) => cart.filter(item => item.supplier === supplier).map(item => item.id);
    // Verified endpoints only: SETA's list, Başbuğ's per-code MalzemeAra (16 Nov 2026) and Dinamik's per-code getStock.
    // No order transaction or product row locks are held while waiting on the supplier; suppliers run side by side (#711).
    const failures = await refreshSuppliersConcurrently(cart, {
      seta: () => importSeta(db, {mode:"commerce"}),
      // Only the cart's own codes, and no wait on a running list import's lock (#763).
      basbug: async () => { Object.assign(unverified, (await refreshBasbugItems(db, ids("basbug"))).failed); },
      // Dinamik answers per code (getStock), so only the cart's own rows are re-read: ~0.5 s per four lines
      // instead of whole brand lists (up to ~35 s), and no wait on a running nightly brand import.
      dinamik: () => refreshDinamikItems(db, ids("dinamik")),
    });
    for (const { supplier, reason } of failures)
      for (const id of ids(supplier)) unverified[id] ??= fallbackReason(reason);
  }
  return { items: cart.map(item => item.id), mode, unverified };
}
