import "server-only";
import { db } from "@/lib/db";
import type { VehicleImage } from "./vehicle-catalog";

type ImageRow = { key: string; media_id: string; sha256: string; width: number; height: number };
const validIds = (ids: string[]) => [...new Set(ids.filter(id => /^\d{1,10}$/.test(id)))];

function collect(rows: ImageRow[]) {
  return new Map<string, VehicleImage>(rows.map(row => [row.key,
    { src: `/api/vehicle-media/${row.media_id}?v=${row.sha256.slice(0, 16)}`, width: row.width, height: row.height }]));
}

/** REPXPERT pictures of vehicle types by id; types without one are absent. */
export async function getVehicleTypeImages(typeIds: string[]) {
  const ids = validIds(typeIds);
  if (!ids.length) return new Map<string, VehicleImage>();
  const { rows } = await db.query<ImageRow>(`SELECT i.vehicle_type_id::text AS key, i.media_id, m.sha256, i.width, i.height
    FROM vehicle_type_images i JOIN product_media_objects m ON m.id=i.media_id WHERE i.vehicle_type_id=ANY($1::int[])`, [ids]);
  return collect(rows);
}

/** One picture per model series: its most recent type that has a picture stands for the series. */
export async function getVehicleModelImages(modelIds: string[]) {
  const ids = validIds(modelIds);
  if (!ids.length) return new Map<string, VehicleImage>();
  const { rows } = await db.query<ImageRow>(`SELECT DISTINCT ON (t.model_id) t.model_id::text AS key, i.media_id, m.sha256, i.width, i.height
    FROM vehicle_types t JOIN vehicle_type_images i ON i.vehicle_type_id=t.id JOIN product_media_objects m ON m.id=i.media_id
    WHERE t.model_id=ANY($1::int[]) ORDER BY t.model_id, t.year_of_constr_from DESC, t.id DESC`, [ids]);
  return collect(rows);
}
