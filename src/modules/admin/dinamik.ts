import "server-only";
import { z } from "zod";
import { getProduct } from "@/modules/store/catalog";
import { adminProductPricing } from "@/modules/admin/product-pricing";
import type { SupplierChange } from "./supplier-changes";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { requireAdmin } from "@/modules/auth/session";
import { binder, dinamikItemMatch } from "@/modules/search/sql";
import { supplierItemPage } from "./supplier-items";
import { DINAMIK_COMPANY, DINAMIK_WAREHOUSE } from "@/modules/suppliers/dinamik-import";
import { dinamikRegion, dinamikRegions, type DinamikStockData } from "@/modules/suppliers/dinamik-stock";

export type DinamikParams = { q?: string; brand?: string; group?: string; region?: string; stock?: string; quality?: string; presence?: string; page?: string; sort?: string; dir?: string };
// Header sorting on the item list (TableHead sortKey → column); the same order is applied to the page and its join.
const itemSorts = { code: "code", name: "product_data->>'stokAdi'", brand: "list_group", cost: "CASE WHEN jsonb_typeof(price_data->'fiyat')='number' THEN (price_data->>'fiyat')::numeric END" };
export type DinamikItem = {
  id: string; code: string; list_group: string;
  product_data: { stokKodu: string; marka: string; stokAdi?: string | null; ingilizceAdi?: string | null; kull1s?: string; kull3s?: string; kull7s?: string; kull8s?: string;
    oemListe?: string; esdegerListe?: string; barkod1?: string; barkod2?: string; barkod3?: string; resimUrl?: string; paketMiktari?: number; koliMiktari?: number; olcuBirimi?: string; desi?: number };
  price_data: { fiyat: number | null; kampanyaOrani?: number } | null;
  stock_data: DinamikStockData | null;
  product_count: number; price_count: number; stock_count: number; conflicting: boolean;
  source_variants: Record<string, unknown>;
  presence: "present" | "pending_missing" | "inactive";
  first_seen_at: Date; last_seen_at: Date; changed_at: Date; missing_count: number;
  sale_price_kurus?: number | null; sale_available?: boolean | null; sale_stock_label?: string | null;
};

const anyVar = (alias = "") => `(${dinamikRegions.map(region => `${alias}stock_data->>'${region.key}'='VAR'`).join(" OR ")})`;

// ~50 part types across ~1M rows: a full DISTINCT costs ~0.5 s, so the unfiltered list is reused for a while.
let allGroups: { at: number; values: string[] } | undefined;

/** `presentTotal`: the overview's present-row count, used as the total of the unfiltered list. */
export async function adminDinamikItems(params: DinamikParams, presentTotal?: Promise<number>) {
  await requireAdmin();
  const values: unknown[] = [DINAMIK_COMPANY, DINAMIK_WAREHOUSE];
  const conditions = ["supplier='dinamik'", "company=$1", "warehouse=$2"];
  const add = (clause: string, value: unknown) => { values.push(value); conditions.push(clause.replaceAll("?", `$${values.length}`)); };
  const presence = ["pending_missing", "inactive", "all"].includes(params.presence ?? "") ? params.presence! : "present";
  if (presence !== "all") add("presence=?", presence);
  const scopeConditions = conditions.length;
  const brand = params.brand?.slice(0, 60) || "";
  if (brand) add("list_group=?", brand);
  if (params.group) add("product_data->>'kull7s'=?", params.group.slice(0, 120));
  const q = params.q?.trim().slice(0, 120);
  if (q) conditions.push(dinamikItemMatch("supplier_items", q, binder(values)));
  const region = dinamikRegion(params.region);
  if (["1", "0", "unknown"].includes(params.stock ?? "")) {
    const has = region === "any" ? anyVar() : `stock_data->>'${region}'='VAR'`;
    conditions.push(params.stock === "unknown" ? "stock_data IS NULL" : params.stock === "1" ? has : `stock_data IS NOT NULL AND NOT ${has}`);
  }
  if (params.quality === "missing-price") conditions.push("price_data->'fiyat' IS NULL OR jsonb_typeof(price_data->'fiyat')='null'");
  if (params.quality === "price-only") conditions.push("stock_data IS NULL");
  if (params.quality === "campaign") conditions.push("COALESCE((price_data->>'kampanyaOrani')::numeric,0)<>0");
  if (params.quality === "duplicates") conditions.push("(product_count>1 OR price_count>1 OR stock_count>1)");
  if (params.quality === "conflicts") conditions.push("conflicting");
  const where = conditions.map(condition => `(${condition})`).join(" AND ");
  const fresh = allGroups && Date.now() - allGroups.at < 10 * 60_000;
  // Unfiltered view: the overview counts the same rows (present, this company and warehouse), so the
  // ~0.3 s count over ~1M rows is not repeated.
  const unfiltered = presence === "present" && conditions.length === scopeConditions;
  // Default order follows supplier_items_supplier_company_list_group_warehouse_code_key (brand, then code) so the
  // page is an index walk instead of a sort of every row: brand first, then code.
  const order = sortOrder(params, itemSorts, "list_group,code,id");
  const [list, brands, groups] = await Promise.all([
    supplierItemPage<DinamikItem>({ where, values, order, page: params.page, total: unfiltered ? presentTotal : undefined }),
    db.query<{ list_group: string }>("SELECT list_group FROM supplier_sync_scopes WHERE supplier='dinamik' AND company=$1 AND warehouse=$2 AND last_success_at IS NOT NULL ORDER BY list_group", [DINAMIK_COMPANY, DINAMIK_WAREHOUSE]),
    !brand && fresh ? Promise.resolve(null) : db.query<{ value: string }>(`SELECT DISTINCT product_data->>'kull7s' AS value FROM supplier_items
      WHERE supplier='dinamik' AND company=$1 AND warehouse=$2 AND presence='present' AND ($3='' OR list_group=$3) AND COALESCE(product_data->>'kull7s','')<>'' ORDER BY value`, [DINAMIK_COMPANY, DINAMIK_WAREHOUSE, brand]),
  ]);
  if (groups && !brand) allGroups = { at: Date.now(), values: groups.rows.map(row => row.value) };
  return { ...list, brands: brands.rows.map(row => row.list_group), groups: groups ? groups.rows.map(row => row.value) : allGroups!.values };
}

export async function adminDinamikItem(id: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;
  // Everything below needs only the id, so the detail page waits for one round of queries.
  const [result, changes, sale, pricing] = await Promise.all([
    db.query<DinamikItem>("SELECT * FROM supplier_items WHERE id=$1 AND supplier='dinamik'", [id]),
    db.query<SupplierChange>("SELECT * FROM supplier_item_changes WHERE item_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 20", [id]),
    getProduct(id), adminProductPricing(id),
  ]);
  const item = result.rows[0];
  return item ? { ...item, changes: changes.rows, sale, pricing } : null;
}
