import "server-only";
import type { PoolClient } from "pg";
import type { CartOwner } from "./cart";
import { db } from "@/lib/db";
import { importBasbug } from "@/modules/suppliers/basbug-import";
import { importSeta } from "@/modules/suppliers/seta-import";
import { supplierCheckoutMode } from "./supplier-checkout-policy";

export type CheckoutScope = {supplier:"basbug"|"seta";company:string;list_group:string;warehouse:string};
export async function checkoutScopes(owner:CartOwner, connection:Pick<PoolClient,"query">=db) {
  return (await connection.query<CheckoutScope>(`SELECT DISTINCT i.supplier,i.company,i.list_group,i.warehouse
    FROM supplier_items i JOIN commerce_cart_items c ON c.product_id=i.id
    WHERE c.owner_kind=$1 AND c.owner_id=$2 AND i.supplier IN ('basbug','seta') ORDER BY i.supplier,i.company,i.list_group,i.warehouse`,
    [owner.kind,owner.id])).rows;
}
export async function refreshCheckoutSources(owner:CartOwner) {
  const scopes = await checkoutScopes(owner);
  const mode = await supplierCheckoutMode();
  // These are verified list endpoints; do not guess per-code price or reservation APIs.
  // No order transaction or product row locks are held while waiting on the supplier.
  for (const scope of mode === "live" ? scopes : []) {
    if (scope.supplier === "seta") await importSeta(db, {mode:"commerce"});
    else await importBasbug(db, {company:scope.company,group:scope.list_group,warehouse:"MRK",mode:"commerce"});
  }
  return { scopes, mode };
}
