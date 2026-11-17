import "server-only";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, supplierItemMatch } from "@/modules/search/sql";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { manualCompany } from "@/modules/suppliers/storefront-sources";
import { manualCategories, type ManualDraftReport, type ManualOverrides } from "@/modules/suppliers/manual-import";
import type { ManualRow } from "@/modules/suppliers/manual-template";
import type { ManualBulkReport } from "@/modules/suppliers/manual-bulk";
import type { ManualBulkExportRow } from "@/modules/suppliers/manual-bulk-csv";
import { manualBulkPageNumber as pageNumber } from "@/modules/suppliers/manual-bulk-paging";
import { manualDraft } from "@/modules/suppliers/manual-bulk";
import { z } from "zod";
import type { SupplierChange } from "./supplier-changes";
import { supplierItemPage, type SaleFields } from "./supplier-items";
import { getProduct } from "@/modules/store/catalog";
import { itemProductSql, shownImageSql } from "@/modules/store/product-image-sql";
import { adminProductPricing } from "@/modules/admin/product-pricing";

export type ManualParams = { liste?: string; taslak?: string; q?: string; category?: string; stock?: string; quality?: string; presence?: string;
  page?: string; degisiklik?: string; bulgu?: string; sort?: string; dir?: string; uploaded?: string; imported?: string; discarded?: string; bulk?: string; error?: string; detail?: string;
  /** "1": the bulk CSV of every list (#844). */
  tum?: string };
type ManualList = { list_group: string; list_name: string; present: number; missing_prices: number; missing_packages: number; last_import: Date | null };
/** kind "list": an xlsx list upload; "bulk": a price/stock CSV, whose report also carries the diff (report.bulk). */
export type ManualUpload = { id: string; list_group: string; list_name: string; file_name: string; status: "draft" | "imported" | "discarded";
  kind: "list" | "bulk"; report: ManualDraftReport & Partial<Pick<ManualBulkReport, "bulk">>; created_at: Date; decided_at: Date | null; import_id: string | null; uploader: string | null;
  stats: Record<string, number> | null; quality: Record<string, number> | null };
type ManualItemData = { no: string; ac: string; uk: string; category_id: number; category_name: string; barcode: string | null; description: string | null;
  viscosity: string | null; package: string | null; approvals: string | null; image_url: string | null; list_name: string; file: Omit<ManualRow, "sheet" | "row"> };
export type ManualItem = {
  id: string; code: string; list_group: string; product_data: ManualItemData; price_data: { nf: number; list?: number; discount?: number } | null; stock_data: { stok: number } | null;
  presence: "present" | "pending_missing" | "inactive"; conflicting: boolean; product_count: number;
  sale_price_kurus: number | null; sale_available: boolean | null; sale_stock_label: string | null; has_image: boolean; overridden: boolean;
};

const itemSorts = { code: "code", name: "product_data->>'ac'", brand: "product_data->>'uk'", cost: "(price_data->>'nf')::numeric" };
const scope = "supplier='manual' AND company=$1";

export async function adminManualLists() {
  await requireAdmin();
  return (await db.query<ManualList>(`SELECT list_group,(array_agg(product_data->>'list_name' ORDER BY changed_at DESC))[1] AS list_name,
      count(*) FILTER (WHERE presence='present')::int AS present,
      count(*) FILTER (WHERE presence='present' AND price_data IS NULL)::int AS missing_prices,
      count(*) FILTER (WHERE presence='present' AND COALESCE(product_data->>'package','')='')::int AS missing_packages,
      (SELECT max(completed_at) FROM supplier_imports r WHERE r.supplier='manual' AND r.company=$1 AND r.list_group=i.list_group AND r.status='succeeded') AS last_import
    FROM supplier_items i WHERE ${scope} GROUP BY list_group ORDER BY list_group`, [manualCompany])).rows;
}

export async function adminManualData(params: ManualParams) {
  await requireAdmin();
  const draftId = z.uuid().safeParse(params.taslak).success ? params.taslak! : null;
  // A draft keeps every file row (~100 KB); the preview shows the first ten and the row count.
  const [lists, uploads, draft, categories] = await Promise.all([
    adminManualLists(),
    db.query<ManualUpload>(`SELECT u.id,u.list_group,u.list_name,u.file_name,u.status,u.kind,u.report - 'issues' - 'bulk' || jsonb_build_object('issues','[]'::jsonb) AS report,
      u.created_at,u.decided_at,u.import_id,a.name AS uploader,r.stats,r.quality FROM manual_uploads u LEFT JOIN accounts a ON a.id=u.uploaded_by
      LEFT JOIN supplier_imports r ON r.id=u.import_id ORDER BY u.created_at DESC LIMIT 15`),
    draftId ? manualDraft(db, draftId, pageNumber(params.degisiklik), pageNumber(params.bulgu)) : null,
    manualCategories(db),
  ]);
  const list = lists.find(entry => entry.list_group === params.liste) ?? lists[0];
  const [products, listCategories] = list ? await Promise.all([
    manualItems(list.list_group, params),
    db.query<{ value: string }>(`SELECT DISTINCT product_data->>'category_name' AS value FROM supplier_items
      WHERE ${scope} AND list_group=$2 AND presence='present' ORDER BY value`, [manualCompany, list.list_group]).then(result => result.rows.map(row => row.value)),
  ]) : [null, [] as string[]];
  return { lists, list, uploads: uploads.rows, draft, listCategories, products,
    categoryNames: new Map(categories.map(category => [category.id, category.name])) };
}

// The image the store shows (#596): an admin upload, or the enrichment image unless the admin hid it.
const shownImage = (item: string) => shownImageSql(itemProductSql(`${item}.id`),
  `EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=${item}.id AND e.image_id IS NOT NULL)`);

/** The product tab's filters (list, presence, search, category, stock, quality) as a WHERE clause on supplier_items; null: every list. */
function manualItemFilter(listGroup: string | null, params: ManualParams) {
  const values: unknown[] = [manualCompany];
  const conditions = [scope];
  if (listGroup !== null) { values.push(listGroup); conditions.push(`list_group=$${values.length}`); }
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
  if (params.quality === "missing-image") conditions.push(`NOT ${shownImage("supplier_items")}`);
  return { where: conditions.join(" AND "), values };
}

async function manualItems(listGroup: string, params: ManualParams) {
  const { where, values } = manualItemFilter(listGroup, params);
  return supplierItemPage<Omit<ManualItem, keyof SaleFields>>({
    where, values, order: sortOrder(params, itemSorts, "code,id"), page: params.page,
    select: `supplier_items.*,
      ${shownImage("supplier_items")} AS has_image,
      EXISTS (SELECT 1 FROM manual_item_overrides o WHERE o.list_group=supplier_items.list_group AND o.code=supplier_items.code AND o.fields<>'{}') AS overridden`,
  });
}

/**
 * The bulk price/stock CSV of the selected list, filtered like the product tab, without paging (#832). `tum=1`: every
 * list's present items in one file with the list name (#844); the tab's filters belong to one list and are ignored.
 */
export async function adminManualBulkExport(params: ManualParams) {
  await requireAdmin();
  const lists = await adminManualLists();
  if (params.tum === "1") {
    if (!lists.length) return null;
    // The same names the upload resolves the Liste cells against.
    const names = new Map(lists.map(entry => [entry.list_group, entry.list_name]));
    const rows = await manualBulkExportRows(null, {});
    return { list: null, combined: true, rows: rows.map(row => ({ ...row, listName: names.get(row.listGroup) ?? row.listGroup })) };
  }
  const list = lists.find(entry => entry.list_group === params.liste) ?? lists[0];
  if (!list) return null;
  return { list, combined: false, rows: await manualBulkExportRows(list.list_group, params) };
}

async function manualBulkExportRows(listGroup: string | null, params: ManualParams) {
  const { where, values } = manualItemFilter(listGroup, params);
  return (await db.query<ManualBulkExportRow & { listGroup: string }>(`SELECT COALESCE(product_data->>'uk','') AS brand,code,
      supplier_items.list_group AS "listGroup",
      COALESCE((price_data->>'list')::float8,(price_data->>'nf')::float8) AS list,COALESCE((price_data->>'discount')::float8,0) AS discount,
      p.markup_percent::float8 AS markup,(stock_data->>'stok')::float8 AS stock
    FROM supplier_items LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=supplier_items.id
    WHERE ${where} ORDER BY supplier_items.list_group,code`, values)).rows;
}

export async function adminManualItem(id: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;
  // Everything below needs only the id, so the detail page waits for one round of queries.
  const [result, changes, categories, sale, pricing] = await Promise.all([
    db.query<ManualItem & {
      first_seen_at: Date; last_seen_at: Date; changed_at: Date; price_count: number; stock_count: number; source_variants: Record<string, unknown>;
      overrides: ManualOverrides | null; overrides_updated_at: Date | null;
    }>(`SELECT i.*,${shownImage("i")} AS has_image,o.fields AS overrides,o.updated_at AS overrides_updated_at FROM supplier_items i
      LEFT JOIN manual_item_overrides o ON o.list_group=i.list_group AND o.code=i.code
      WHERE i.supplier='manual' AND i.company=$1 AND i.id=$2`, [manualCompany, id]),
    db.query<SupplierChange>("SELECT * FROM supplier_item_changes WHERE item_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 20", [id]),
    manualCategories(db), getProduct(id), adminProductPricing(id),
  ]);
  const item = result.rows[0];
  return item ? { ...item, changes: changes.rows, categories, sale, pricing } : null;
}
