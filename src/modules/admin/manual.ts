import "server-only";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, supplierItemMatch } from "@/modules/search/sql";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { manualCompany } from "@/modules/suppliers/storefront-sources";
import { manualCategories, type ManualDraftReport, type ManualOverrides } from "@/modules/suppliers/manual-import";
import type { ManualRow } from "@/modules/suppliers/manual-template";
import { z } from "zod";
import type { SupplierChange } from "./supplier-changes";

export type ManualParams = { liste?: string; taslak?: string; q?: string; category?: string; stock?: string; quality?: string; presence?: string;
  page?: string; sort?: string; dir?: string; uploaded?: string; imported?: string; discarded?: string; error?: string; detail?: string };
export type ManualList = { list_group: string; list_name: string; present: number; missing_prices: number; missing_packages: number; last_import: Date | null };
export type ManualUpload = { id: string; list_group: string; list_name: string; file_name: string; status: "draft" | "imported" | "discarded";
  report: ManualDraftReport; created_at: Date; decided_at: Date | null; import_id: string | null; uploader: string | null;
  stats: Record<string, number> | null; quality: Record<string, number> | null };
export type ManualItemData = { no: string; ac: string; uk: string; category_id: number; category_name: string; barcode: string | null; description: string | null;
  viscosity: string | null; package: string | null; approvals: string | null; image_url: string | null; list_name: string; file: Omit<ManualRow, "sheet" | "row"> };
export type ManualItem = {
  id: string; code: string; list_group: string; product_data: ManualItemData; price_data: { nf: number } | null; stock_data: { stok: number } | null;
  presence: "present" | "pending_missing" | "inactive"; conflicting: boolean; product_count: number;
  sale_price_kurus: number | null; sale_available: boolean | null; sale_stock_label: string | null; has_image: boolean; overridden: boolean;
};

const itemSorts = { code: "code", name: "product_data->>'ac'", brand: "product_data->>'uk'", cost: "(price_data->>'nf')::numeric" };
const scope = "supplier='manual' AND company=$1";

export async function adminManualLists() {
  return (await db.query<ManualList>(`SELECT list_group,(array_agg(product_data->>'list_name' ORDER BY changed_at DESC))[1] AS list_name,
      count(*) FILTER (WHERE presence='present')::int AS present,
      count(*) FILTER (WHERE presence='present' AND price_data IS NULL)::int AS missing_prices,
      count(*) FILTER (WHERE presence='present' AND COALESCE(product_data->>'package','')='')::int AS missing_packages,
      (SELECT max(completed_at) FROM supplier_imports r WHERE r.supplier='manual' AND r.company=$1 AND r.list_group=i.list_group AND r.status='succeeded') AS last_import
    FROM supplier_items i WHERE ${scope} GROUP BY list_group ORDER BY list_group`, [manualCompany])).rows;
}

export async function adminManualData(params: ManualParams) {
  await requireAdmin();
  const lists = await adminManualLists();
  const draftId = z.uuid().safeParse(params.taslak).success ? params.taslak! : null;
  const [uploads, draft, categories] = await Promise.all([
    db.query<ManualUpload>(`SELECT u.id,u.list_group,u.list_name,u.file_name,u.status,u.report - 'issues' || jsonb_build_object('issues','[]'::jsonb) AS report,
      u.created_at,u.decided_at,u.import_id,a.name AS uploader,r.stats,r.quality FROM manual_uploads u LEFT JOIN accounts a ON a.id=u.uploaded_by
      LEFT JOIN supplier_imports r ON r.id=u.import_id ORDER BY u.created_at DESC LIMIT 15`),
    draftId ? db.query<ManualUpload & { rows: ManualRow[] }>(`SELECT u.*,a.name AS uploader FROM manual_uploads u LEFT JOIN accounts a ON a.id=u.uploaded_by WHERE u.id=$1`, [draftId]) : null,
    manualCategories(db),
  ]);
  const list = lists.find(entry => entry.list_group === params.liste) ?? lists[0];
  const products = list ? await manualItems(list.list_group, params) : null;
  const listCategories = list ? (await db.query<{ value: string }>(`SELECT DISTINCT product_data->>'category_name' AS value FROM supplier_items
    WHERE ${scope} AND list_group=$2 AND presence='present' ORDER BY value`, [manualCompany, list.list_group])).rows.map(row => row.value) : [];
  const currentDraft = draft?.rows[0];
  return { lists, list, uploads: uploads.rows, draft: currentDraft, listCategories, products,
    categoryNames: new Map(categories.map(category => [category.id, category.name])) };
}

async function manualItems(listGroup: string, params: ManualParams) {
  const values: unknown[] = [manualCompany, listGroup];
  const conditions = [scope, "list_group=$2"];
  const presence = ["pending_missing", "inactive", "all"].includes(params.presence ?? "") ? params.presence : "present";
  if (presence !== "all") { values.push(presence); conditions.push(`presence=$${values.length}`); }
  const q = params.q?.trim().slice(0, 120);
  if (q) conditions.push(supplierItemMatch("supplier_items", parseSearchQuery(q), binder(values)));
  if (params.category) { values.push(params.category.slice(0, 200)); conditions.push(`product_data->>'category_name'=$${values.length}`); }
  if (params.stock === "1") conditions.push("(stock_data->>'stok')::numeric>0");
  if (params.stock === "0") conditions.push("(stock_data->>'stok')::numeric=0");
  if (params.stock === "none") conditions.push("stock_data IS NULL");
  if (params.quality === "missing-price") conditions.push("price_data IS NULL");
  if (params.quality === "missing-package") conditions.push("COALESCE(product_data->>'package','')=''");
  if (params.quality === "missing-image") conditions.push("NOT EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=supplier_items.id AND e.image_id IS NOT NULL)");
  const where = conditions.join(" AND ");
  const total = Number((await db.query<{ count: string }>(`SELECT count(*) FROM supplier_items WHERE ${where}`, values)).rows[0].count);
  const pages = Math.max(1, Math.ceil(total / 50));
  const parsedPage = Number(params.page);
  const page = Number.isSafeInteger(parsedPage) ? Math.min(pages, Math.max(1, parsedPage)) : 1;
  const order = sortOrder(params, itemSorts, "code,id");
  const items = await db.query<ManualItem>(`WITH page AS MATERIALIZED (
    SELECT * FROM supplier_items WHERE ${where} ORDER BY ${order} LIMIT 50 OFFSET $${values.length + 1}
  ) SELECT page.*,sale.price_kurus AS sale_price_kurus,sale.available AS sale_available,sale.stock_label AS sale_stock_label,
    EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=page.id AND e.image_id IS NOT NULL) AS has_image,
    EXISTS (SELECT 1 FROM manual_item_overrides o WHERE o.list_group=page.list_group AND o.code=page.code AND o.fields<>'{}') AS overridden
    FROM page LEFT JOIN LATERAL (SELECT price_kurus,available,stock_label FROM commerce_catalog WHERE id=page.id OFFSET 0) sale ON true
    ORDER BY ${order}`, [...values, (page - 1) * 50]);
  return { items: items.rows, total, page, pages };
}

export async function adminManualItem(id: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;
  const { rows } = await db.query<ManualItem & {
    first_seen_at: Date; last_seen_at: Date; changed_at: Date; price_count: number; stock_count: number; source_variants: Record<string, unknown>;
    image_id: string | null; overrides: ManualOverrides | null;
  }>(`SELECT i.*,e.image_id,o.fields AS overrides FROM supplier_items i LEFT JOIN product_enrichments e ON e.supplier_item_id=i.id
    LEFT JOIN manual_item_overrides o ON o.list_group=i.list_group AND o.code=i.code
    WHERE i.supplier='manual' AND i.company=$1 AND i.id=$2`, [manualCompany, id]);
  if (!rows[0]) return null;
  const changes = (await db.query<SupplierChange>("SELECT * FROM supplier_item_changes WHERE item_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 20", [id])).rows;
  return { ...rows[0], changes, categories: await manualCategories(db) };
}
