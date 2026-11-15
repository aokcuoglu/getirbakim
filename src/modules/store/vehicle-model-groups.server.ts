import "server-only";
import { db } from "@/lib/db";
import { staleCache } from "@/lib/stale-cache";
import type { VehicleBrand, VehicleModel } from "./vehicle-catalog";
import { vehicleModelGroups, type VehicleModelGroup } from "./vehicle-model-groups";

// The vehicle catalog changes only with TecDoc imports; a make's units and its fitted units are shared per process.
const cachedGroups = staleCache<VehicleModelGroup[]>(10 * 60 * 1000, 300);
const cachedListed = staleCache<string[]>(10 * 60 * 1000, 300);

/** A make's model page units (#639), oldest first. */
export function getVehicleModelGroups(brandId: string) {
  return cachedGroups(brandId, async () => vehicleModelGroups((await db.query<VehicleModel>(`SELECT id::text, brand_id::text AS "brandId", name,
    to_char(date_from, 'YYYY-MM') AS "dateFrom", to_char(date_to, 'YYYY-MM') AS "dateTo"
    FROM vehicle_models WHERE brand_id=$1`, [brandId])).rows));
}

export async function getVehicleModelGroup(make: VehicleBrand, slug: string) {
  return (await getVehicleModelGroups(make.id)).find(group => group.slug === slug);
}

/**
 * The make's units with a fitted product: an engine-level fit (storefront_model_fits) or a model read from a
 * supplier description (product_model_fitments) on any of their series. The make page links only these.
 */
export async function getListedModelGroups(brandId: string) {
  const [groups, fitted] = await Promise.all([getVehicleModelGroups(brandId), cachedListed(brandId, async () =>
    (await db.query<{ id: string }>(`SELECT m.id::text FROM vehicle_models m WHERE m.brand_id=$1
      AND (EXISTS (SELECT 1 FROM storefront_model_fits f WHERE f.model_id=m.id) OR EXISTS (SELECT 1 FROM product_model_fitments f WHERE f.model_id=m.id))`,
      [brandId])).rows.map(row => row.id))]);
  const ids = new Set(fitted);
  return groups.filter(group => group.models.some(model => ids.has(model.id)));
}

export type ModelGroupEngines = { fuel: string; engines: number; cc: [number, number] | null; hp: [number, number] | null };

/** The unit's engine types per fuel, most common first: how many, cubic capacity and power ranges. */
export async function getModelGroupEngines(modelIds: string[]): Promise<ModelGroupEngines[]> {
  const { rows } = await db.query<{ fuel: string; engines: number; cc_min: number | null; cc_max: number | null; hp_min: number | null; hp_max: number | null }>(
    `SELECT COALESCE(NULLIF(fuel_name,''),'Diğer') AS fuel, count(*)::int AS engines, min(NULLIF(cc,0)) AS cc_min, max(NULLIF(cc,0)) AS cc_max,
      min(NULLIF(hp,0)) AS hp_min, max(NULLIF(hp,0)) AS hp_max
     FROM vehicle_types WHERE model_id=ANY($1::int[]) GROUP BY 1 ORDER BY 2 DESC, 1`, [modelIds]);
  const range = (min: number | null, max: number | null): [number, number] | null => min === null || max === null ? null : [min, max];
  return rows.map(row => ({ fuel: row.fuel, engines: row.engines, cc: range(row.cc_min, row.cc_max), hp: range(row.hp_min, row.hp_max) }));
}
