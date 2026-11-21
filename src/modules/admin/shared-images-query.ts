import "server-only";
import type { Pool } from "pg";
import { z } from "zod";
import { pickKey, sortOrder } from "@/lib/table-sort";
import { automaticImageHiddenSql, uploadedImageSql } from "@/modules/store/product-image-sql";
import { pageBounds, requestedPage } from "@/modules/admin/supplier-items";

/** Shared automatic images (#1097): one enrichment image used by several part numbers, read-only. */
export const sharedImagePageSize = 50;
/** Tabs of the list: the fewest distinct part numbers an image must serve. */
export const minPartsOptions = { "2": 2, "5": 5, "10": 10, "25": 25 } as const;
export type MinParts = keyof typeof minPartsOptions;

type Database = Pick<Pool, "query">;
export type ListParams = { min?: string; host?: string; page?: string; sort?: string; dir?: string };
export type DetailParams = { page?: string; sort?: string; dir?: string };

export type SharedImage = {
  image_id: string; parts: number; donors: number; manufacturers: string[]; sha256: string; source_url: string; host: string;
  store_rows: number; samples: string[]; total: number;
};
export type SharedImageHeader = Omit<SharedImage, "total" | "samples">;
export type SharedImageRow = {
  supplier_item_id: string; supplier: string; supplier_code: string; supplier_brand: string; name: string | null;
  in_store: boolean; product_id: string | null; uploaded: boolean; hidden: boolean; total: number;
};

const listOrder = { parts: "sh.parts", rows: "sh.donors", host: "sh.host" };
const listFallback = "sh.parts DESC, sh.image_id";
const detailOrder = { brand: "l.supplier_brand", code: "l.supplier_code", name: "name" };
const detailFallback = "l.supplier_brand, l.supplier_code, l.supplier_item_id";

const aggregate = (where: string, having: string) => `
  SELECT e.image_id, count(DISTINCT e.manufacturer_part_number)::int AS parts, count(*)::int AS donors,
    COALESCE(array_agg(DISTINCT e.manufacturer) FILTER (WHERE e.manufacturer IS NOT NULL), '{}') AS manufacturers
  FROM product_enrichments e WHERE e.image_id IS NOT NULL${where} GROUP BY e.image_id${having}`;
const storeRowsSql = "SELECT count(*)::int FROM product_enrichment_shared_links l JOIN supplier_items s ON s.id=l.supplier_item_id WHERE l.image_id=sh.image_id AND s.presence='present' AND s.company=ANY($2::text[])";

/** The list page; `database` is injectable for tests (the session check lives in listSharedImages). */
export async function sharedImagesPage(database: Database, params: ListParams, companies: string[]) {
  const min = minPartsOptions[pickKey(minPartsOptions, params.min, "5")];
  const host = params.host ?? "";
  const order = sortOrder(params, listOrder, listFallback);
  const listed = `listed AS (SELECT sh.*, m.sha256, m.source_url, split_part(m.source_url,'/',3) AS host
    FROM shared sh JOIN product_media_objects m ON m.id=sh.image_id WHERE ($3::text='' OR split_part(m.source_url,'/',3)=$3))`;
  const at = async (page: number) => (await database.query<SharedImage>(
    `WITH shared AS (${aggregate("", " HAVING count(DISTINCT e.manufacturer_part_number) >= $1")}), ${listed},
      paged AS (SELECT sh.*, count(*) OVER()::int AS total FROM listed sh ORDER BY ${order} LIMIT $4 OFFSET $5)
     SELECT sh.image_id, sh.parts, sh.donors, sh.manufacturers, sh.sha256, sh.source_url, sh.host, sh.total,
       (${storeRowsSql}) AS store_rows,
       ARRAY(SELECT DISTINCT supplier_item_name(s.supplier, s.product_data) FROM product_enrichment_shared_links l JOIN supplier_items s ON s.id=l.supplier_item_id
         WHERE l.image_id=sh.image_id AND supplier_item_name(s.supplier, s.product_data) IS NOT NULL LIMIT 3) AS samples
     FROM paged sh ORDER BY ${order}`,
    [min, companies, host, sharedImagePageSize, (page - 1) * sharedImagePageSize],
  )).rows;
  const [hosts, wantedRows] = await Promise.all([
    database.query<{ host: string; count: number }>(
      `WITH shared AS (${aggregate("", " HAVING count(DISTINCT e.manufacturer_part_number) >= $1")})
       SELECT split_part(m.source_url,'/',3) AS host, count(*)::int AS count FROM shared sh JOIN product_media_objects m ON m.id=sh.image_id
       GROUP BY 1 ORDER BY 2 DESC, 1`, [min]),
    at(requestedPage(params.page)),
  ]);
  let rows = wantedRows, page = requestedPage(params.page);
  if (!rows.length && page > 1) {
    const first = await at(1);
    page = Math.min(page, pageBounds(first[0]?.total ?? 0, sharedImagePageSize).pages);
    rows = page === 1 ? first : await at(page);
  }
  const total = rows[0]?.total ?? 0;
  return { images: rows, total, page, ...pageBounds(total, sharedImagePageSize), min: String(min), host, hostOptions: hosts.rows };
}

/** One image with the supplier rows that show it; null when the media is unknown or no enrichment uses it. */
export async function sharedImageDetail(database: Database, id: string, params: DetailParams, companies: string[]) {
  if (!z.uuid().safeParse(id).success) return null;
  const header = (await database.query<SharedImageHeader>(
    `WITH shared AS (${aggregate(" AND e.image_id=$1", "")})
     SELECT sh.image_id, sh.parts, sh.donors, sh.manufacturers, m.sha256, m.source_url, split_part(m.source_url,'/',3) AS host,
       (${storeRowsSql}) AS store_rows
     FROM shared sh JOIN product_media_objects m ON m.id=sh.image_id`, [id, companies])).rows[0];
  if (!header) return null;
  const order = sortOrder(params, detailOrder, detailFallback);
  const at = async (page: number) => (await database.query<SharedImageRow>(
    `WITH page AS (
       SELECT l.supplier_item_id, l.supplier_code, l.supplier_brand, s.supplier, supplier_item_name(s.supplier, s.product_data) AS name,
         (s.presence='present' AND s.company=ANY($2::text[])) AS in_store, count(*) OVER()::int AS total
       FROM product_enrichment_shared_links l JOIN supplier_items s ON s.id=l.supplier_item_id WHERE l.image_id=$1
       ORDER BY ${order} LIMIT $3 OFFSET $4)
     SELECT l.supplier_item_id, l.supplier, l.supplier_code, l.supplier_brand, l.name, l.in_store, l.total, ps.product_id,
       COALESCE(${uploadedImageSql("ps.product_id")}, false) AS uploaded, COALESCE(${automaticImageHiddenSql("ps.product_id")}, false) AS hidden
     FROM page l LEFT JOIN product_sources ps ON ps.supplier_item_id=l.supplier_item_id ORDER BY ${order}`,
    [id, companies, sharedImagePageSize, (page - 1) * sharedImagePageSize],
  )).rows;
  let page = requestedPage(params.page), rows = await at(page);
  if (!rows.length && page > 1) {
    const first = await at(1);
    page = Math.min(page, pageBounds(first[0]?.total ?? 0, sharedImagePageSize).pages);
    rows = page === 1 ? first : await at(page);
  }
  const total = rows[0]?.total ?? 0;
  return { header, rows, total, page, ...pageBounds(total, sharedImagePageSize) };
}
