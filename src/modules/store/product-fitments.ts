import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { FitmentOverrides, StoreVehicle } from "./product-fitment-display";

/**
 * The admin's vehicle decisions of the products the given store rows belong to (db/product-override-fitments.sql,
 * #583), in one query, oldest first: added types with their catalog vehicle, removed type ids. Rows of products
 * without any are left out.
 */
export async function getOverrideFitments(itemIds: string[]) {
  const result = new Map<string, FitmentOverrides>();
  if (!itemIds.length) return result;
  const rows = (await db.query<StoreVehicle & { supplier_item_id: string; mode: "add" | "remove" }>(
    `SELECT s.supplier_item_id::text,o.mode,v.id AS "vehicleTypeId",m.brand_id AS "brandId",v.model_id AS "modelId",
      b.display_name||' '||m.name AS model,v.name AS "engineAndCodes",v.name AS "catalogEngine",b.display_name AS "catalogBrand",
      v.fuel_type AS fuel,v.kwt AS kw,v.hp AS ps,COALESCE(v.cc,0) AS cc,
      to_char(v.year_of_constr_from,'MM/YYYY') AS "from",to_char(v.year_of_constr_to,'MM/YYYY') AS "to"
     FROM product_sources s
     JOIN product_override_fitments o ON o.product_id=s.product_id
     JOIN vehicle_types v ON v.id=o.vehicle_type_id JOIN vehicle_models m ON m.id=v.model_id JOIN vehicle_brands b ON b.id=m.brand_id
     WHERE s.supplier_item_id=ANY($1::uuid[]) ORDER BY o.created_at,o.id`, [itemIds])).rows;
  for (const { supplier_item_id: id, mode, ...vehicle } of rows) {
    const overrides = result.get(id) ?? { added: [], removed: [] };
    if (mode === "add") overrides.added.push(vehicle);
    else overrides.removed.push(vehicle.vehicleTypeId);
    result.set(id, overrides);
  }
  return result;
}

/** One store row's vehicle decisions, read once per request. */
export const getItemFitments = cache(async (itemId: string): Promise<FitmentOverrides> =>
  (await getOverrideFitments([itemId])).get(itemId) ?? { added: [], removed: [] });

/**
 * The vehicle series whose model pages list a store row through its engine-level fits (storefront_model_fits, #674),
 * read once per request. The product page links an engine-level row to its model page only when the series is here:
 * the table follows a fitment change within seconds, and a link before that could end in the model page's 404.
 */
export const getItemModelFits = cache(async (itemId: string) => new Set((await db.query<{ model_id: number }>(
  "SELECT model_id FROM storefront_model_fits WHERE supplier_item_id=$1", [itemId])).rows.map(row => row.model_id)));
