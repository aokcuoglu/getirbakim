import "server-only";
import { db } from "@/lib/db";
import { staleCache } from "@/lib/stale-cache";
import type { VehicleBrand, VehicleModel } from "./vehicle-catalog";
import { vehicleModelGroups, type VehicleModelGroup } from "./vehicle-model-groups";

// The vehicle catalog changes only with TecDoc imports; a make's units are shared per process.
const cachedGroups = staleCache<VehicleModelGroup[]>(10 * 60 * 1000, 300);
const cachedEngines = staleCache<ModelGroupEngines[]>(10 * 60 * 1000, 300);

/** A make's model page units (#639), oldest first. */
export function getVehicleModelGroups(brandId: string) {
  return cachedGroups(brandId, async () => vehicleModelGroups((await db.query<VehicleModel>(`SELECT id::text, brand_id::text AS "brandId", name,
    to_char(date_from, 'YYYY-MM') AS "dateFrom", to_char(date_to, 'YYYY-MM') AS "dateTo"
    FROM vehicle_models WHERE brand_id=$1`, [brandId])).rows));
}

export async function getVehicleModelGroup(make: VehicleBrand, slug: string) {
  return (await getVehicleModelGroups(make.id)).find(group => group.slug === slug);
}

export type ModelGroupEngines = { fuel: string; engines: number; cc: [number, number] | null; hp: [number, number] | null };

/** The unit's engine types per fuel, most common first: how many, cubic capacity and power ranges. */
export const getModelGroupEngines = (modelIds: string[]) => cachedEngines(modelIds.join(","), async () => {
  const { rows } = await db.query<{ fuel: string; engines: number; cc_min: number | null; cc_max: number | null; hp_min: number | null; hp_max: number | null }>(
    `SELECT COALESCE(NULLIF(fuel_name,''),'Diğer') AS fuel, count(*)::int AS engines, min(NULLIF(cc,0)) AS cc_min, max(NULLIF(cc,0)) AS cc_max,
      min(NULLIF(hp,0)) AS hp_min, max(NULLIF(hp,0)) AS hp_max
     FROM vehicle_types WHERE model_id=ANY($1::int[]) GROUP BY 1 ORDER BY 2 DESC, 1`, [modelIds]);
  const range = (min: number | null, max: number | null): [number, number] | null => min === null || max === null ? null : [min, max];
  return rows.map(row => ({ fuel: row.fuel, engines: row.engines, cc: range(row.cc_min, row.cc_max), hp: range(row.hp_min, row.hp_max) }));
});
