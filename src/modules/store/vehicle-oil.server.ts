import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { staleCache } from "@/lib/stale-cache";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { engineOilNameSql, notEngineOilNameSql, oilMatches, oilSpecificationKeys, plainEngineOilNameSql, productOilSpec, vehicleOilFilters,
  type OilFilter, type ProductOilSpec, type VehicleOilSpec } from "./vehicle-oil";

type OilRow = { viscosities: string[]; acea: string[]; api: string[]; approvals: string[]; capacity_min_l: string | null; capacity_max_l: string | null };

/** The vehicle type's recommended engine oil; null when the oil sheet has no row for it. */
export const getVehicleOilSpec = cache(async (vehicleTypeId: string | null | undefined): Promise<VehicleOilSpec | null> => {
  if (!vehicleTypeId || !/^\d{1,9}$/.test(vehicleTypeId)) return null;
  const row = (await db.query<OilRow>(`SELECT viscosities,acea,api,approvals,capacity_min_l::text,capacity_max_l::text
   FROM vehicle_type_oil_specs WHERE vehicle_type_id=$1`, [vehicleTypeId])).rows[0];
  return row ? { viscosities: row.viscosities, acea: row.acea, api: row.api, approvals: row.approvals,
    capacityMin: row.capacity_min_l === null ? null : Number(row.capacity_min_l), capacityMax: row.capacity_max_l === null ? null : Number(row.capacity_max_l) } : null;
});

// Engine oils change only with supplier syncs and enrichment imports, like the catalog's other id lists.
const cachedOils = staleCache<{ id: string; spec: ProductOilSpec }[]>(10 * 60 * 1000, 1);
/**
 * Every listed engine oil with the specs it states. Candidates come from one regex pass over product names
 * (a grade such as "5W-30", or "MOTOR YAĞI"); their trusted enrichment specifications are then read by id.
 * Expanding every enrichment's specifications to find oils instead scans the whole enrichment table.
 */
export const engineOils = () => cachedOils("all", async () => {
  const candidates = (await db.query<{ id: string; name: string }>(`SELECT catalog.id::text,catalog.name FROM commerce_catalog_entries catalog
   WHERE (catalog.source='store' OR catalog.company=ANY($1::text[])) AND (catalog.name ~* $2 OR catalog.name ~* $3) AND catalog.name !~* $4`,
  [storefrontCompanies(), engineOilNameSql, plainEngineOilNameSql, notEngineOilNameSql])).rows;
  if (!candidates.length) return [];
  // One pass over the shared view for every candidate id. A correlated subquery per candidate re-sorted the
  // whole view each time (~0.3 s × 400+ oils: two minutes on the first request of a process).
  const specs = new Map((await db.query<{ id: string; specs: string }>(`SELECT e.supplier_item_id::text AS id,string_agg(spec->>1,', ') AS specs
    FROM product_enrichment_shared e
    JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
    CROSS JOIN LATERAL jsonb_array_elements(e.payload->'specifications') spec
    WHERE e.supplier_item_id=ANY($1::uuid[]) AND spec->>0=ANY($2::text[]) GROUP BY e.supplier_item_id`,
  [candidates.map(row => row.id), oilSpecificationKeys])).rows.map(row => [row.id, row.specs]));
  return candidates.flatMap(row => { const spec = productOilSpec(row.name, specs.get(row.id) ?? ""); return spec ? [{ id: row.id, spec }] : []; });
});

export async function engineOilIds() { return (await engineOils()).map(oil => oil.id); }

/**
 * Engine oils meeting the vehicle's recommendation on every selected filter the vehicle's data can answer; none
 * without oil data or without such a filter.
 */
export async function vehicleOilProductIds(vehicleTypeId: string, filters: ReadonlySet<OilFilter>) {
  const vehicle = await getVehicleOilSpec(vehicleTypeId);
  const applicable = new Set(vehicle ? vehicleOilFilters(vehicle).filter(filter => filters.has(filter)) : []);
  if (!vehicle || !applicable.size) return [];
  return (await engineOils()).filter(oil => oilMatches(oil.spec, vehicle, applicable)).map(oil => oil.id);
}
