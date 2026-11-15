import "server-only";
import { db } from "@/lib/db";
import { staleCache } from "@/lib/stale-cache";
import { categoryProductIds } from "./catalog";
import { sellableProducts } from "./maintenance-kit.server";
import type { OilCandidate, OilTarget } from "./related-rules";
import { engineOils } from "./vehicle-oil.server";

/** Engine oil is suggested in packs a shopper carries home, not workshop barrels. */
export const maxOilLitres = 5;

// The candidate ids only: the suggestion's own sellableProducts call prices the picked ones live, so a product that went
// out of stock or lost its price since is still never shown.
const cachedCandidates = staleCache<OilCandidate[]>(5 * 60 * 1000, 1);
/** Engine oils of at most `maxOilLitres` per pack that were sellable when the list was built (#715). */
export const suggestableOils = () => cachedCandidates("all", async () => {
  const small = (await engineOils()).flatMap(oil => oil.litres !== null && oil.litres <= maxOilLitres ? [{ ...oil, litres: oil.litres }] : []);
  const sellable = new Set((await sellableProducts(small.map(oil => oil.id))).map(product => product.id));
  return small.filter(oil => sellable.has(oil.id));
});

// Same as the oils: the fluids that had a price and stock when the list was built, priced again live when suggested.
const cachedFluids = staleCache<string[]>(5 * 60 * 1000, 50);
/**
 * The sellable products of a fluid category (brake fluid, coolant…) for the dialog's fluid pick (#715). Most listed fluids
 * have no offer; ranking the whole category and pricing only the first few left the sellable ones out, so the rotation
 * runs over these.
 */
export const sellableFluidIds = (categoryId: number) => cachedFluids(String(categoryId), async () =>
  (await sellableProducts(await categoryProductIds([], [categoryId]))).map(product => product.id));

type TargetRow = { viscosities: string[]; acea: string[]; approvals: string[]; capacity: string | null; types: number };

/**
 * The recommended engine oils of the vehicle types the added product (its offer group) fits, through its trusted
 * enrichment's fitments, grouped by recommendation and weighted by the number of types; the capacity is the group's
 * largest (targetCapacity averages the groups by weight). Read once per enrichment row:
 * the vehicles payload is taken out in the materialized CTE, not per fitment.
 */
export async function productOilTargets(group: readonly string[]): Promise<OilTarget[]> {
  if (!group.length) return [];
  const rows = (await db.query<TargetRow>(`WITH e AS MATERIALIZED (SELECT e.donor_item_id,e.payload->'vehicles' AS vehicles FROM storefront_enrichments e
      JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
       AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
      WHERE e.supplier_item_id=ANY($1::uuid[])),
    types AS (SELECT DISTINCT f.vehicle_type_id FROM e JOIN product_vehicle_fitments f ON f.supplier_item_id=e.donor_item_id
      AND f.vehicle_type_id IS NOT NULL AND f.source_vehicle=e.vehicles->f.source_index)
    SELECT o.viscosities,o.acea,o.approvals,max(o.capacity_max_l)::text AS capacity,count(*)::int AS types
    FROM types JOIN vehicle_type_oil_specs o USING (vehicle_type_id) GROUP BY o.viscosities,o.acea,o.approvals`, [group])).rows;
  return rows.map(row => ({ weight: row.types, spec: { viscosities: row.viscosities, acea: row.acea, api: [], approvals: row.approvals,
    capacityMin: null, capacityMax: row.capacity === null ? null : Number(row.capacity) } }));
}
