import "server-only";
import { db } from "@/lib/db";

// /yonetim/arac-gorselleri: progress of the REPXPERT vehicle collection (scripts/vehicle-repxpert.ts) and the pictures
// it stored, newest first, so the page can follow a running collection.

export type VehicleTypeImageRow = {
  vehicle_type_id: string; full_name: string; src: string; width: number; height: number; imported_at: Date;
  body_type: string | null; engine_codes: string[];
};
export type VehicleCollectionSummary = {
  types: number; found: number; missing: number; errors: number; images: number; distinctImages: number;
  lastTen: number; lastFetch: Date | null;
};
export type VehicleTypeImagesData = { summary: VehicleCollectionSummary; rows: VehicleTypeImageRow[]; total: number; page: number; pages: number; q: string };

export const VEHICLE_IMAGES_PAGE_SIZE = 48;

export async function vehicleTypeImagesData(params: Record<string, string | undefined>): Promise<VehicleTypeImagesData> {
  const q = (params.q ?? "").trim().slice(0, 80);
  const requested = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // Type number, or words of the brand/model/type name ("corsa d 1.4").
  const filter = /^\d{1,10}$/.test(q) ? "t.id=$1::int" : q ? `concat_ws(' ', b.display_name, m.name, t.name) ILIKE ALL ($1::text[])` : "true";
  const filterValue = /^\d{1,10}$/.test(q) ? q : q ? q.split(/\s+/).map(word => `%${word.replace(/[%_\\]/g, "\\$&")}%`) : null;
  const from = `FROM vehicle_type_images i JOIN vehicle_types t ON t.id=i.vehicle_type_id JOIN vehicle_models m ON m.id=t.model_id
    JOIN vehicle_brands b ON b.id=m.brand_id`;
  const [summary, total] = await Promise.all([
    db.query<VehicleCollectionSummary>(`SELECT (SELECT count(*) FROM vehicle_types)::int AS types,
        count(*) FILTER (WHERE s.outcome='found')::int AS found, count(*) FILTER (WHERE s.outcome='missing')::int AS missing,
        count(*) FILTER (WHERE s.outcome='error')::int AS errors,
        (SELECT count(*) FROM vehicle_type_images)::int AS images, (SELECT count(DISTINCT media_id) FROM vehicle_type_images)::int AS "distinctImages",
        count(*) FILTER (WHERE s.fetched_at > now() - interval '10 minutes')::int AS "lastTen", max(s.fetched_at) AS "lastFetch"
      FROM vehicle_type_specs s`),
    db.query<{ count: number }>(`SELECT count(*)::int AS count ${from} WHERE ${filter}`, filterValue === null ? [] : [filterValue]),
  ]);
  const pages = Math.max(1, Math.ceil(total.rows[0].count / VEHICLE_IMAGES_PAGE_SIZE));
  const page = Math.min(requested, pages);
  const values: unknown[] = filterValue === null ? [] : [filterValue];
  const { rows } = await db.query<Omit<VehicleTypeImageRow, "src"> & { media_id: string; sha256: string }>(`SELECT t.id::text AS vehicle_type_id,
      COALESCE(s.full_name, concat_ws(' ', b.display_name, m.name, t.name)) AS full_name, i.media_id, o.sha256, i.width, i.height, i.imported_at,
      s.body_type, COALESCE(s.engine_codes, '{}') AS engine_codes
    ${from} JOIN product_media_objects o ON o.id=i.media_id LEFT JOIN vehicle_type_specs s ON s.vehicle_type_id=t.id
    WHERE ${filter} ORDER BY i.imported_at DESC, t.id DESC LIMIT ${VEHICLE_IMAGES_PAGE_SIZE} OFFSET ${(page - 1) * VEHICLE_IMAGES_PAGE_SIZE}`, values);
  return {
    summary: summary.rows[0], total: total.rows[0].count, page, pages, q,
    rows: rows.map(({ media_id, sha256, ...row }) => ({ ...row, src: `/api/vehicle-media/${media_id}?v=${sha256.slice(0, 16)}` })),
  };
}
