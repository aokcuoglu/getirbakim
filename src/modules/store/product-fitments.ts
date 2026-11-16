import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { emptyFitmentOverrides, type FitmentOverrides, type StoreVehicle } from "./product-fitment-display";

/**
 * The admin's vehicle decisions of the products the given store rows belong to (db/product-override-fitments.sql,
 * #583), oldest first: added types with their catalog vehicle, removed type ids; and the source rows the admin hid
 * (#661; description models are left out here, storefront_description_fits applies them). Rows of products without
 * any are left out.
 */
export async function getOverrideFitments(itemIds: string[]) {
  const result = new Map<string, FitmentOverrides>();
  if (!itemIds.length) return result;
  const [decisions, hides] = await Promise.all([
    db.query<StoreVehicle & { supplier_item_id: string; mode: "add" | "remove" }>(
      `SELECT s.supplier_item_id::text,o.mode,v.id AS "vehicleTypeId",m.brand_id AS "brandId",v.model_id AS "modelId",
        b.display_name||' '||m.name AS model,v.name AS "engineAndCodes",v.name AS "catalogEngine",b.display_name AS "catalogBrand",
        v.fuel_type AS fuel,v.kwt AS kw,v.hp AS ps,COALESCE(v.cc,0) AS cc,
        to_char(v.year_of_constr_from,'MM/YYYY') AS "from",to_char(v.year_of_constr_to,'MM/YYYY') AS "to"
       FROM product_sources s
       JOIN product_override_fitments o ON o.product_id=s.product_id
       JOIN vehicle_types v ON v.id=o.vehicle_type_id JOIN vehicle_models m ON m.id=v.model_id JOIN vehicle_brands b ON b.id=m.brand_id
       WHERE s.supplier_item_id=ANY($1::uuid[]) ORDER BY o.created_at,o.id`, [itemIds]),
    db.query<{ supplier_item_id: string; kind: "source_vehicle" | "source_model"; source_key: string }>(
      `SELECT s.supplier_item_id::text,h.kind,h.source_key FROM product_sources s
       JOIN product_override_fitment_hides h ON h.product_id=s.product_id
       WHERE s.supplier_item_id=ANY($1::uuid[]) AND h.kind<>'description_model'`, [itemIds]),
  ]);
  const of = (id: string) => {
    const overrides = result.get(id) ?? emptyFitmentOverrides();
    result.set(id, overrides);
    return overrides;
  };
  for (const { supplier_item_id: id, mode, ...vehicle } of decisions.rows) {
    const overrides = of(id);
    if (mode === "add") overrides.added.push(vehicle);
    else overrides.removed.push(vehicle.vehicleTypeId);
  }
  for (const row of hides.rows) of(row.supplier_item_id).hidden[row.kind === "source_vehicle" ? "vehicles" : "models"].push(row.source_key);
  return result;
}

/** One store row's vehicle decisions, read once per request. */
export const getItemFitments = cache(async (itemId: string): Promise<FitmentOverrides> =>
  (await getOverrideFitments([itemId])).get(itemId) ?? emptyFitmentOverrides());

/**
 * The vehicle series whose model pages list a store row through its engine-level fits (storefront_model_fits, #674),
 * read once per request. The product page links an engine-level row to its model page only when the series is here:
 * the table follows a fitment change within seconds, and a link before that could end in the model page's 404.
 */
export const getItemModelFits = cache(async (itemId: string) => new Set((await db.query<{ model_id: number }>(
  "SELECT model_id FROM storefront_model_fits WHERE supplier_item_id=$1", [itemId])).rows.map(row => row.model_id)));
