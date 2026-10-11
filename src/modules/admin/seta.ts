import "server-only";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, supplierItemMatch } from "@/modules/search/sql";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { supplierHealth } from "@/modules/suppliers/health";
import { setaCompany } from "@/modules/suppliers/storefront-sources";
import { z } from "zod";
import type { SupplierChange } from "./supplier-changes";

export type SetaParams = { q?: string; category?: string; stock?: string; quality?: string; presence?: string; page?: string; updated?: string; error?: string };
export type SetaImportSummary = {
  id: string; run_kind: "full" | "commerce"; status: string; error_reason: string | null; review_note: string | null;
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
  const [snapshot, recentRuns, health, categories] = await Promise.all([
    db.query<SetaImportSummary>(`SELECT * FROM supplier_imports WHERE ${scope} AND status='succeeded' AND run_kind='full' ORDER BY completed_at DESC,id DESC LIMIT 1`, [setaCompany]),
    db.query<SetaImportSummary>(`SELECT * FROM supplier_imports WHERE ${scope} ORDER BY started_at DESC,id DESC LIMIT 10`, [setaCompany]),
    supplierHealth(db, setaCompany),
    db.query<{ value: string }>(`SELECT DISTINCT product_data->>'source_category' AS value FROM supplier_items WHERE ${scope} AND presence='present' AND product_data->>'source_category' IS NOT NULL ORDER BY value`, [setaCompany]),
  ]);
  const values: unknown[] = [setaCompany];
  const conditions = [scope];
  const presence = ["pending_missing", "inactive", "all"].includes(params.presence ?? "") ? params.presence : "present";
  if (presence !== "all") { values.push(presence); conditions.push(`presence=$${values.length}`); }
  const q = params.q?.trim().slice(0, 120);
  // Same engine as the storefront: name, vehicle application, code and OEM numbers.
  if (q) conditions.push(supplierItemMatch("supplier_items", parseSearchQuery(q), binder(values)));
  if (params.category) { values.push(params.category.slice(0, 200)); conditions.push(`product_data->>'source_category'=$${values.length}`); }
  if (params.stock === "1" || params.stock === "0") { values.push(params.stock); conditions.push(`stock_data->>'stok'=$${values.length}`); }
  if (params.quality === "missing-price") conditions.push("price_data IS NULL");
  if (params.quality === "conflicts") conditions.push("conflicting");
  const where = conditions.join(" AND ");
  const total = Number((await db.query<{ count: string }>(`SELECT count(*) FROM supplier_items WHERE ${where}`, values)).rows[0].count);
  const pages = Math.max(1, Math.ceil(total / 50));
  const parsedPage = Number(params.page);
  const page = Number.isSafeInteger(parsedPage) ? Math.min(pages, Math.max(1, parsedPage)) : 1;
  const items = await db.query<SetaItem>(`WITH page AS MATERIALIZED (
    SELECT * FROM supplier_items WHERE ${where} ORDER BY code,id LIMIT 50 OFFSET $${values.length + 1}
  ) SELECT page.*,sale.price_kurus AS sale_price_kurus,sale.available AS sale_available,sale.stock_label AS sale_stock_label
    FROM page LEFT JOIN LATERAL (SELECT price_kurus,available,stock_label FROM commerce_catalog WHERE id=page.id OFFSET 0) sale ON true
    ORDER BY page.code,page.id`, [...values, (page - 1) * 50]);
  return { snapshot: snapshot.rows[0], recentRuns: recentRuns.rows, health, categories: categories.rows.map(row => row.value),
    items: items.rows, total, page, pages };
}

export async function adminSetaItem(id: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;
  const { rows } = await db.query<SetaItem & {
    first_seen_at: Date; last_seen_at: Date; changed_at: Date; price_count: number; stock_count: number;
    missing_count: number; source_variants: Record<string, unknown>;
  }>("SELECT * FROM supplier_items WHERE supplier='seta' AND company=$1 AND id=$2", [setaCompany, id]);
  if (!rows[0]) return null;
  const changes = (await db.query<SupplierChange>("SELECT * FROM supplier_item_changes WHERE item_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 20", [id])).rows;
  return { ...rows[0], changes };
}
