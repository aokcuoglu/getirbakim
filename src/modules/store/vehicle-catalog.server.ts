import "server-only";
import { db } from "@/lib/db";
import { normalizeVehicleSearch, vehicleBrandSlug, vehicleDetails, type CatalogVehicle, type VehicleBrand, type VehicleModel } from "./vehicle-catalog";

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

export async function getVehicleModels(brandId: string): Promise<VehicleModel[] | null> {
  if (!validId(brandId)) return null;
  const { rows } = await db.query<VehicleModel>(`SELECT id::text, brand_id::text AS "brandId", name,
    to_char(date_from, 'YYYY-MM') AS "dateFrom", to_char(date_to, 'YYYY-MM') AS "dateTo"
    FROM vehicle_models WHERE brand_id=$1`, [brandId]);
  if (!rows.length && !(await db.query("SELECT 1 FROM vehicle_brands WHERE id=$1", [brandId])).rowCount) return null;
  return rows.sort((a, b) => a.name.localeCompare(b.name, "tr", { numeric: true }));
}

export async function getModelVehicles(modelId: string): Promise<CatalogVehicle[] | null> {
  if (!validId(modelId)) return null;
  const { rows } = await db.query<VehicleRow>(`SELECT ${vehicleFields} ${vehicleJoins} WHERE v.model_id=$1`, [modelId]);
  if (!rows.length && !(await db.query("SELECT 1 FROM vehicle_models WHERE id=$1", [modelId])).rowCount) return null;
  return rows.map(formatVehicle).sort((a, b) => a.engine.localeCompare(b.engine, "tr", { numeric: true }) || a.from - b.from || Number(a.id) - Number(b.id));
}

export async function searchVehicleCatalog(query: string, offset = 0, limit = 60) {
  const terms = normalizeVehicleSearch(query).trim().split(/\s+/).filter(Boolean);
  // Escape LIKE metacharacters: %, _ and backslash are literal search input.
  const parameters: (string | number)[] = terms.map(term => `%${term.replace(/[\\%_]/g, "\\$&")}%`);
  const where = terms.length ? terms.map((_, index) => `v.search_text LIKE $${index + 1}`).join(" AND ") : "TRUE";
  parameters.push(limit, offset);
  // Count and page share one snapshot, including when offset is beyond the last match.
  const { rows } = await db.query<{ total: number; vehicles: VehicleRow[] }>(`
    WITH matches AS MATERIALIZED (SELECT v.id FROM vehicle_types v WHERE ${where})
    SELECT (SELECT count(*)::integer FROM matches) AS total,
      COALESCE((SELECT jsonb_agg(page) FROM (
        SELECT ${vehicleFields} ${vehicleJoins} JOIN matches ON matches.id=v.id
        ORDER BY v.name, v.year_of_constr_from, v.id LIMIT $${terms.length + 1} OFFSET $${terms.length + 2}
      ) page), '[]'::jsonb) AS vehicles`, parameters);
  return { vehicles: rows[0].vehicles.map(formatVehicle), total: rows[0].total };
}

export async function savedCatalogVehicle(id: string, year: number) {
  if (!validId(id) || !Number.isInteger(year)) return null;
  const { rows } = await db.query<VehicleRow>(`SELECT ${vehicleFields} ${vehicleJoins} WHERE v.id=$1`, [id]);
  if (!rows.length) return null;
  const vehicle = formatVehicle(rows[0]);
  if (year < vehicle.from || year > vehicle.to) return null;
  return vehicleDetails(vehicle, year);
}
