import "server-only";
import { db } from "@/lib/db";
import { staleCache, weighJson, weighStrings } from "@/lib/stale-cache";
import { modelPath } from "@/modules/seo/paths";
import { vehicleBrandSlug, type VehicleBrand, type VehicleImage, type VehicleModel } from "./vehicle-catalog";
import { getVehicleModelImages } from "./vehicle-images.server";
import { vehicleModelGroups, type VehicleModelGroup } from "./vehicle-model-groups";

// The vehicle catalog changes only with TecDoc imports; a make's units are shared per process.
// Approximate bytes (#1461): each of the four caches may hold 8 MB.
const groupsBound = 8 * 1024 * 1024;
const cachedGroups = staleCache<VehicleModelGroup[]>(10 * 60 * 1000, 300,{name:"model-groups",weigh:weighJson,maxWeight:groupsBound});
const cachedEngines = staleCache<ModelGroupEngines[]>(10 * 60 * 1000, 300,{name:"model-engines",weigh:weighJson,maxWeight:groupsBound});
const cachedFacts = staleCache<ModelGroupFacts>(10 * 60 * 1000, 300,{name:"model-facts",weigh:weighJson,maxWeight:groupsBound});
const cachedMotorcycles = staleCache<string[]>(10 * 60 * 1000, 300,{name:"motorcycles",weigh:weighStrings,maxWeight:groupsBound});
// REPXPERT's body type of two-wheelers (db/vehicle-type-specs.sql, npm run vehicles:repxpert).
const motorcycleBody = "İki tekerlekli taşıt";

const modelColumns = `id::text, brand_id::text AS "brandId", name,
    to_char(date_from, 'YYYY-MM') AS "dateFrom", to_char(date_to, 'YYYY-MM') AS "dateTo"`;

/** A make's model page units (#639), oldest first. */
export function getVehicleModelGroups(brandId: string) {
  return cachedGroups(brandId, async () => vehicleModelGroups((await db.query<VehicleModel>(
    `SELECT ${modelColumns} FROM vehicle_models WHERE brand_id=$1`, [brandId])).rows));
}

/**
 * Every make's units by brand id from one query (#778), for the sitemap: it needs all ~250 makes, and one read replaces
 * as many. Not cached and does not fill the per-make cache above.
 */
export async function loadAllVehicleModelGroups() {
  const byBrand = new Map<string, VehicleModel[]>();
  for (const row of (await db.query<VehicleModel>(`SELECT ${modelColumns} FROM vehicle_models`)).rows) {
    const rows = byBrand.get(row.brandId);
    if (rows) rows.push(row); else byBrand.set(row.brandId, [row]);
  }
  return new Map([...byBrand].map(([brandId, rows]) => [brandId, vehicleModelGroups(rows)]));
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

/**
 * The model page of each series (#674): series id → /yedek-parca/<make>/<unit>, for links from a product's fitments.
 * Series of the same unit share the path; unknown ids are absent. The makes' units come from the cached groups.
 */
export async function getModelPagePaths(modelIds: number[]) {
  const ids = [...new Set(modelIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  const paths = new Map<number, string>();
  if (!ids.length) return paths;
  const { rows } = await db.query<{ id: number; brand_id: string; make: string }>(`SELECT m.id, m.brand_id::text, b.display_name AS make
    FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id WHERE m.id=ANY($1::int[])`, [ids]);
  const makes = new Map(rows.map(row => [row.brand_id, row.make]));
  await Promise.all([...makes].map(async ([brandId, make]) => {
    for (const group of await getVehicleModelGroups(brandId)) for (const member of group.models) {
      const id = Number(member.id);
      if (ids.includes(id)) paths.set(id, modelPath(vehicleBrandSlug(make), group.slug));
    }
  }));
  return paths;
}

export type ModelGroupFacts = { image?: VehicleImage; bodies: string[]; engineCodes: string[] };

/**
 * A model page unit's REPXPERT facts (#674): the picture of its first series (in `modelIds` order) that has one, its
 * body types and engine codes, most common first (codes then A→Z). Types without specs add nothing.
 */
export const getModelGroupFacts = (modelIds: string[]) => cachedFacts(modelIds.join(","), async () => {
  const [images, specs] = await Promise.all([getVehicleModelImages(modelIds),
    db.query<{ bodies: string[] | null; codes: string[] | null }>(`WITH specs AS MATERIALIZED (SELECT s.body_type, s.engine_codes
      FROM vehicle_types t JOIN vehicle_type_specs s ON s.vehicle_type_id=t.id WHERE t.model_id=ANY($1::int[]) AND s.outcome='found')
     SELECT (SELECT array_agg(body_type ORDER BY n DESC, body_type) FROM (SELECT body_type, count(*) AS n FROM specs
       WHERE NULLIF(body_type, '') IS NOT NULL GROUP BY 1) bodies) AS bodies,
      (SELECT array_agg(code ORDER BY n DESC, code) FROM (SELECT code, count(*) AS n FROM specs, unnest(engine_codes) code
       WHERE NULLIF(code, '') IS NOT NULL GROUP BY 1) codes) AS codes`, [modelIds])]);
  const image = modelIds.map(id => images.get(id)).find(Boolean);
  const row = specs.rows[0];
  return { ...image ? { image } : {}, bodies: row?.bodies ?? [], engineCodes: row?.codes ?? [] };
});

/**
 * A make's series whose every specified type is a two-wheeler (#674): the make page lists their units apart. A series
 * without specs, or with any other body type, is not one.
 */
export async function getMotorcycleModelIds(brandId: string) {
  return new Set(await cachedMotorcycles(brandId, async () => (await db.query<{ id: string }>(`SELECT t.model_id::text AS id
    FROM vehicle_models m JOIN vehicle_types t ON t.model_id=m.id JOIN vehicle_type_specs s ON s.vehicle_type_id=t.id AND s.outcome='found'
    WHERE m.brand_id=$1 GROUP BY t.model_id HAVING bool_and(s.body_type IS NOT DISTINCT FROM $2)`, [brandId, motorcycleBody])).rows.map(row => row.id)));
}
