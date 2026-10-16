import "server-only";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { requireAdmin } from "@/modules/auth/session";
import { vehicleModelImageAttribution } from "@/modules/store/vehicle-model-images";

export const imageStatuses = ["pending", "approved", "rejected"] as const;
export type ImageStatus = typeof imageStatuses[number];
export type ImageKind = "generation" | "family";
const PAGE_SIZE = 40;

export type VehicleImageRow = {
  model_id: string; brand: string; model: string; date_from: string | null; date_to: string | null;
  media_id: string; sha256: string; width: number; height: number; wikidata_id: string; wikidata_label: string; commons_file: string;
  source_url: string; license: string; author: string | null; match_kind: ImageKind; matched_query: string; status: ImageStatus;
  imported_at: Date; reviewed_at: Date | null;
};

export type VehicleImagesData = {
  rows: (VehicleImageRow & { src: string; attribution: string })[];
  total: number; page: number; pages: number;
  status: ImageStatus | "all"; kind: ImageKind | ""; q: string;
  counts: Record<ImageStatus, number> & { generationPending: number; familyPending: number };
  coverage: { models: number; matched: number; approved: number; attempted: number; none: number };
  brands: string[];
};

const sortColumns = { brand: "b.display_name", model: "m.name", kind: "i.match_kind", license: "i.license", imported: "i.imported_at", status: "i.status" };

export async function vehicleImagesData(params: Record<string, string | undefined>): Promise<VehicleImagesData> {
  await requireAdmin();
  const status = (imageStatuses as readonly string[]).includes(params.status ?? "") ? params.status as ImageStatus : params.status === "all" ? "all" : "pending";
  const kind = params.kind === "generation" || params.kind === "family" ? params.kind : "";
  const q = (params.q ?? "").trim().slice(0, 80);
  const page = Math.max(1, Number(params.page) || 1);
  const where = `($1::text='all' OR i.status=$1) AND ($2::text='' OR i.match_kind=$2)
    AND ($3::text='' OR b.display_name ILIKE '%'||$3||'%' OR b.name ILIKE '%'||$3||'%' OR m.name ILIKE '%'||$3||'%' OR i.wikidata_label ILIKE '%'||$3||'%')`;
  const from = `FROM vehicle_model_images i JOIN vehicle_models m ON m.id=i.model_id JOIN vehicle_brands b ON b.id=m.brand_id JOIN product_media_objects o ON o.id=i.media_id`;
  const order = sortOrder(params, sortColumns, "i.imported_at DESC, i.model_id");
  const [list, totals, counts, coverage, brands] = await Promise.all([
    db.query<VehicleImageRow>(`SELECT i.model_id::text, b.display_name AS brand, m.name AS model, to_char(m.date_from,'YYYY-MM') AS date_from, to_char(m.date_to,'YYYY-MM') AS date_to,
      i.media_id, o.sha256, i.width, i.height, i.wikidata_id, i.wikidata_label, i.commons_file, i.source_url, i.license, i.author, i.match_kind, i.matched_query, i.status, i.imported_at, i.reviewed_at
      ${from} WHERE ${where} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, [status, kind, q]),
    db.query<{ count: number }>(`SELECT count(*)::int AS count ${from} WHERE ${where}`, [status, kind, q]),
    db.query<{ status: ImageStatus; match_kind: ImageKind; count: number }>("SELECT status, match_kind, count(*)::int AS count FROM vehicle_model_images GROUP BY 1,2"),
    db.query<{ models: number; matched: number; approved: number; attempted: number; none: number }>(`SELECT count(*)::int AS models, count(i.model_id)::int AS matched,
      count(i.model_id) FILTER (WHERE i.status='approved')::int AS approved, count(l.model_id)::int AS attempted, count(l.model_id) FILTER (WHERE l.outcome<>'matched')::int AS none
      FROM vehicle_models m LEFT JOIN vehicle_model_images i ON i.model_id=m.id LEFT JOIN vehicle_model_image_lookups l ON l.model_id=m.id`),
    db.query<{ brand: string }>("SELECT DISTINCT b.display_name AS brand FROM vehicle_model_images i JOIN vehicle_models m ON m.id=i.model_id JOIN vehicle_brands b ON b.id=m.brand_id ORDER BY 1"),
  ]);
  const summary = { pending: 0, approved: 0, rejected: 0, generationPending: 0, familyPending: 0 };
  for (const row of counts.rows) {
    summary[row.status] += row.count;
    if (row.status === "pending") summary[row.match_kind === "generation" ? "generationPending" : "familyPending"] += row.count;
  }
  const total = totals.rows[0].count;
  return {
    rows: list.rows.map(row => ({ ...row, src: `/api/vehicle-media/${row.media_id}?v=${row.sha256.slice(0, 16)}`, attribution: vehicleModelImageAttribution(row) })),
    total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), status, kind, q, counts: summary, coverage: coverage.rows[0], brands: brands.rows.map(row => row.brand),
  };
}
