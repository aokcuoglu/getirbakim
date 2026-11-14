import "server-only";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, supplierItemMatch } from "@/modules/search/sql";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { supplierHealth } from "@/modules/suppliers/health";
import { supplierRunHistoryLimit } from "@/modules/suppliers/run-status";
import { setaCompany } from "@/modules/suppliers/storefront-sources";
import { z } from "zod";
import { getProduct } from "@/modules/store/catalog";
import { adminProductPricing } from "@/modules/admin/product-pricing";
import type { SupplierChange } from "./supplier-changes";
import { supplierItemPage } from "./supplier-items";

export type SetaParams = { q?: string; category?: string; stock?: string; quality?: string; presence?: string; page?: string; sort?: string; dir?: string; updated?: string; error?: string };
// Header sorting on the item list (TableHead sortKey → column); the same order is applied to the page and its join.
const itemSorts = { code: "code", name: "product_data->>'ac'", cost: "CASE WHEN jsonb_typeof(price_data->'nf')='number' THEN (price_data->>'nf')::numeric END" };
type SetaImportSummary = {
  id: string; list_group: string; warehouse: string; run_kind: "full" | "commerce"; status: string; error_reason: string | null; review_note: string | null;
  stats: Record<string, number>; started_at: Date; completed_at: Date | null; observations: Record<string, string>;
  quality: { productRows: number; uniqueProducts: number; missingPrices: number; outOfStock: number; duplicateCodes: number; conflictingCodes: number };
};
export type SetaItem = {
  id: string; code: string;
  product_data: { ac: string; ac2: string; uk: string; oe: string; dc: string; source_category: string | null; vehicle_brand: string | null; cross: Record<string, string>; image: string };
  price_data: { nf: number; price: string } | null; stock_data: { stok: number } | null;
  product_count: number; conflicting: boolean; presence: "present" | "pending_missing" | "inactive";
  sale_price_kurus: number | null; sale_available: boolean | null; sale_stock_label: string | null;
};

const scope = "supplier='seta' AND company=$1";

export async function adminSetaData(params: SetaParams) {
  await requireAdmin();
  const values: unknown[] = [setaCompany];
  const conditions = [scope];
  const presence = ["pending_missing", "inactive", "all"].includes(params.presence ?? "") ? params.presence : "present";
  if (presence !== "all") { values.push(presence); conditions.push(`presence=$${values.length}`); }
  const q = params.q?.trim().slice(0, 120);
  // Same engine as the storefront: name, vehicle application, code and OEM numbers.
  if (q) conditions.push(supplierItemMatch("supplier_items", parseSearchQuery(q), binder(values)));
  if (params.category) { values.push(params.category.slice(0, 200)); conditions.push(`product_data->>'source_category'=$${values.length}`); }
  if (params.stock === "1" || params.stock === "0") { values.push(params.stock); conditions.push(`stock_data->>'stok'=$${values.length}`); }
  if (params.stock === "unknown") conditions.push("stock_data->>'stok' IS NULL");
  if (params.quality === "missing-price") conditions.push("price_data IS NULL");
  if (params.quality === "duplicates") conditions.push("product_count>1");
  if (params.quality === "conflicts") conditions.push("conflicting");
  const where = conditions.join(" AND ");
  const [snapshot, lastSucceeded, recentRuns, health, categories, list] = await Promise.all([
    db.query<SetaImportSummary>(`SELECT * FROM supplier_imports WHERE ${scope} AND status='succeeded' AND run_kind='full' ORDER BY completed_at DESC,id DESC LIMIT 1`, [setaCompany]),
    db.query<SetaImportSummary>(`SELECT * FROM supplier_imports WHERE ${scope} AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1`, [setaCompany]),
    db.query<SetaImportSummary>(`SELECT * FROM supplier_imports WHERE ${scope} ORDER BY started_at DESC,id DESC LIMIT $2`, [setaCompany, supplierRunHistoryLimit]),
    supplierHealth(db, setaCompany),
    db.query<{ value: string }>(`SELECT DISTINCT product_data->>'source_category' AS value FROM supplier_items WHERE ${scope} AND presence='present' AND product_data->>'source_category' IS NOT NULL ORDER BY value`, [setaCompany]),
    supplierItemPage<SetaItem>({ where, values, order: sortOrder(params, itemSorts, "code,id"), page: params.page }),
  ]);
  return { snapshot: snapshot.rows[0], lastSucceeded: lastSucceeded.rows[0], recentRuns: recentRuns.rows, health, categories: categories.rows.map(row => row.value),
    ...list };
}

export async function adminSetaItem(id: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;
  // Everything below needs only the id, so the detail page waits for one round of queries.
  const [result, changes, sale, pricing] = await Promise.all([
    db.query<SetaItem & {
      first_seen_at: Date; last_seen_at: Date; changed_at: Date; price_count: number; stock_count: number;
      missing_count: number; source_variants: Record<string, unknown>;
    }>("SELECT * FROM supplier_items WHERE supplier='seta' AND company=$1 AND id=$2", [setaCompany, id]),
    db.query<SupplierChange>("SELECT * FROM supplier_item_changes WHERE item_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 20", [id]),
    getProduct(id), adminProductPricing(id),
  ]);
  const item = result.rows[0];
  return item ? { ...item, changes: changes.rows, sale, pricing } : null;
}
