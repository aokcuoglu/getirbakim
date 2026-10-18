import "server-only";
import { db } from "@/lib/db";
import { binder, correctSearch, vehicleTypeMatch } from "@/modules/search/sql";
import { exactTsQuery, parseSearchQuery, searchTooShort, type ParsedSearch } from "@/modules/search/query";
import { vehicleBrandSlug, vehicleDetails, type CatalogVehicle, type VehicleBrand, type VehicleModel } from "./vehicle-catalog";
import { getVehicleModelImages, getVehicleTypeImages } from "./vehicle-images.server";
import { getVehicleOilSpec } from "./vehicle-oil.server";

// SQL only accepts TecDoc integer identifiers; UI/cookies keep string identifiers.
function validId(value: string) {
  return /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647;
}

type VehicleRow = {
  id: string; model_id: string; brand_id: string; make: string; model: string; name: string;
  date_from: string; date_to: string | null; fuel_name: string; hp: number; kwt: number; cc: number | null;
};
const vehicleFields = `v.id::text, v.model_id::text, m.brand_id::text, b.display_name AS make,
  m.name AS model, v.name, to_char(v.year_of_constr_from, 'YYYY-MM') AS date_from,
  to_char(v.year_of_constr_to, 'YYYY-MM') AS date_to, v.fuel_name, v.hp, v.kwt, v.cc`;
const vehicleJoins = `FROM vehicle_types v JOIN vehicle_models m ON m.id=v.model_id JOIN vehicle_brands b ON b.id=m.brand_id`;

function formatVehicle(row: VehicleRow): CatalogVehicle {
  return { id: row.id, modelId: row.model_id, brandId: row.brand_id, make: row.make, model: row.model,
    generation: row.model, from: Number(row.date_from.slice(0, 4)),
    to: row.date_to ? Number(row.date_to.slice(0, 4)) : new Date().getFullYear(),
    dateFrom: row.date_from, dateTo: row.date_to, fuel: row.fuel_name,
    engine: row.name, power: `${row.hp} hp / ${row.kwt} kW`, cc: row.cc };
}

export async function getVehicleBrands(): Promise<VehicleBrand[]> {
  const { rows } = await db.query<VehicleBrand>("SELECT id::text, display_name AS name, popular FROM vehicle_brands");
  return rows.sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

export async function getVehicleBrandBySlug(slug: string) {
  return (await getVehicleBrands()).find(brand => vehicleBrandSlug(brand.name) === slug);
}

// REPXPERT pictures ride along with every model/vehicle list; absent when there is none.
async function withModelImages(models: VehicleModel[]) {
  const images = await getVehicleModelImages(models.map(model => model.id));
  return models.map(model => { const image = images.get(model.id); return image ? { ...model, image } : model; });
}
// A type without its own picture shows its series' picture.
async function withImages(vehicles: CatalogVehicle[]) {
  const own = await getVehicleTypeImages(vehicles.map(vehicle => vehicle.id));
  const series = await getVehicleModelImages(vehicles.filter(vehicle => !own.has(vehicle.id)).map(vehicle => vehicle.modelId));
  return vehicles.map(vehicle => { const image = own.get(vehicle.id) ?? series.get(vehicle.modelId); return image ? { ...vehicle, image } : vehicle; });
}

export async function getVehicleModels(brandId: string): Promise<VehicleModel[] | null> {
  if (!validId(brandId)) return null;
  const { rows } = await db.query<VehicleModel>(`SELECT id::text, brand_id::text AS "brandId", name,
    to_char(date_from, 'YYYY-MM') AS "dateFrom", to_char(date_to, 'YYYY-MM') AS "dateTo"
    FROM vehicle_models WHERE brand_id=$1`, [brandId]);
  if (!rows.length && !(await db.query("SELECT 1 FROM vehicle_brands WHERE id=$1", [brandId])).rowCount) return null;
  return withModelImages(rows.sort((a, b) => a.name.localeCompare(b.name, "tr", { numeric: true })));
}

export async function getModelVehicles(modelId: string): Promise<CatalogVehicle[] | null> {
  if (!validId(modelId)) return null;
  const { rows } = await db.query<VehicleRow>(`SELECT ${vehicleFields} ${vehicleJoins} WHERE v.model_id=$1`, [modelId]);
  if (!rows.length && !(await db.query("SELECT 1 FROM vehicle_models WHERE id=$1", [modelId])).rowCount) return null;
  return withImages(rows.map(formatVehicle).sort((a, b) => a.engine.localeCompare(b.engine, "tr", { numeric: true }) || a.from - b.from || Number(a.id) - Number(b.id)));
}

/** One vehicle type by id, with its picture and recommended oil: the garage tab's card of the saved vehicle. */
export async function getCatalogVehicle(id: string): Promise<CatalogVehicle | null> {
  if (!validId(id)) return null;
  const [{ rows }, oil] = await Promise.all([db.query<VehicleRow>(`SELECT ${vehicleFields} ${vehicleJoins} WHERE v.id=$1`, [id]), getVehicleOilSpec(id)]);
  if (!rows.length) return null;
  const vehicle = (await withImages(rows.map(formatVehicle)))[0];
  return oil ? { ...vehicle, oil } : vehicle;
}

// Make + model words decide the order; dividing by their length (chassis codes in brackets left out)
// puts "GOLF VII" above "GOLF SPORTSVAN VII". Engine words only break ties.
const modelDocument = `to_tsvector('simple', search_normalize(concat_ws(' ', b.display_name, b.name, regexp_replace(m.name, '\\(.*\\)', ''))))`;
const vehicleDocument = `setweight(${modelDocument}, 'A') || setweight(to_tsvector('simple', search_normalize(v.name)), 'B')
  || to_tsvector('simple', search_normalize(v.search_text))`;

async function rankedVehicleSearch(parsed: ParsedSearch, offset: number, limit: number) {
  const values: unknown[] = [];
  const bind = binder(values);
  const exact = exactTsQuery(parsed);
  const where = vehicleTypeMatch("v", parsed, bind);
  const rank = `COALESCE(ts_rank(${modelDocument}, to_tsquery('simple', ${bind(exact)}::text), 2) * 10
    + ts_rank(${vehicleDocument}, to_tsquery('simple', ${bind(exact)}::text)) * 0.1, 0)`;
  const page = `LIMIT ${bind(limit)} OFFSET ${bind(offset)}`;
  // Count and page share one snapshot, including when offset is beyond the last match.
  const { rows } = await db.query<{ total: number; vehicles: VehicleRow[] }>(`
    WITH matches AS MATERIALIZED (SELECT v.id, ${rank} AS rank ${vehicleJoins} WHERE ${where})
    SELECT (SELECT count(*)::integer FROM matches) AS total,
      COALESCE((SELECT jsonb_agg(page ORDER BY ordinal) FROM (
        SELECT ${vehicleFields}, row_number() OVER (ORDER BY matches.rank DESC, b.display_name, m.name, v.name, v.year_of_constr_from, v.id) AS ordinal
        ${vehicleJoins} JOIN matches ON matches.id=v.id
        ORDER BY ordinal ${page}
      ) page), '[]'::jsonb) AS vehicles`, values);
  return { vehicles: await withImages(rows[0].vehicles.map(formatVehicle)), total: rows[0].total };
}

export type VehicleSearchResult = { vehicles: CatalogVehicle[]; total: number; correctedQuery?: string };

export async function searchVehicleCatalog(query: string, offset = 0, limit = 60): Promise<VehicleSearchResult> {
  const parsed = parseSearchQuery(query, { years: true });
  if (searchTooShort(query) || (!parsed.terms.length && !parsed.years.length)) return { vehicles: [], total: 0 };
  const result = await rankedVehicleSearch(parsed, offset, limit);
  if (result.total) return result;
  // Nothing matched as typed: retry with mistyped words corrected ("volksvagen pasat").
  const corrected = await correctSearch(query, "vehicle", { years: true });
  if (!corrected) return result;
  const retry = await rankedVehicleSearch(corrected.parsed, offset, limit);
  return retry.total ? { ...retry, correctedQuery: corrected.text } : result;
}

export async function savedCatalogVehicle(id: string, year: number) {
  if (!validId(id) || !Number.isInteger(year)) return null;
  const { rows } = await db.query<VehicleRow>(`SELECT ${vehicleFields} ${vehicleJoins} WHERE v.id=$1`, [id]);
  if (!rows.length) return null;
  const vehicle = formatVehicle(rows[0]);
  if (year < vehicle.from || year > vehicle.to) return null;
  return vehicleDetails(vehicle, year);
}
