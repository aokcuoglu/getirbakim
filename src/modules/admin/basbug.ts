import "server-only";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, supplierItemMatch } from "@/modules/search/sql";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { supplierHealth } from "@/modules/suppliers/health";
import { supplierRunHistoryLimit } from "@/modules/suppliers/run-status";
import { z } from "zod";
import { supplierItemPage } from "./supplier-items";
import { getProduct } from "@/modules/store/catalog";
import { adminProductPricing } from "@/modules/admin/product-pricing";
import type { SupplierChange } from "./supplier-changes";
import { basbugWarehouse, type BasbugStockData } from "@/modules/suppliers/basbug-stock";
import { openPriceAnomalyCount, openPriceAnomalyFilter, type PriceAnomalyEvidence, type PriceAnomalyKind } from "@/modules/suppliers/price-anomalies";

export type BasbugParams = { q?: string; group?: string; brand?: string; currency?: string; warehouse?: string; stock?: string; quality?: string; presence?: string; page?: string; sort?: string; dir?: string; updated?: string; error?: string };
// Header sorting on the item list (TableHead sortKey → column); the same order is applied to the page and its join.
const itemSorts = { code: "code", name: "product_data->>'ac'", brand: "product_data->>'uk'", cost: "CASE WHEN jsonb_typeof(price_data->'nf')='number' THEN (price_data->>'nf')::numeric END" };
type ImportSummary = {
  run_kind: "full" | "commerce"; status: string; error_reason: string | null; review_note: string | null; stats: Record<string, number>;
  id: string; company: string; list_group: string; warehouse: string;
  started_at: Date; completed_at: Date;
  quality: { productRows: number; priceRows: number; stockRows: number; uniqueProducts: number; missingPrices: number; missingStocks: number; duplicateCodes: number; conflictingCodes: number; orphanPrices: number; orphanStocks: number };
  groups_data: { malzemeGruplariListesi: { kod: string; ad: string }[] };
  currencies_data: { dovizListesi: { dovizCinsi: string; alis: string; satis: string }[] };
  observations: Record<string, string>;
};
export type AdminSupplierItem = {
  id: string; code: string;
  product_data: { ac: string; ac2: string; uk: string; oe: string; lgk: string; m: string; mo: string; y: string; b: string; dc: string; lf: number; mkk: string };
  price_data: { nf: number; mif: number; k: number } | null;
  stock_data: BasbugStockData | null;
  product_count: number; price_count: number; stock_count: number; conflicting: boolean;
  source_variants: Record<string, unknown>;
  presence: "present" | "pending_missing" | "inactive";
  first_seen_at: Date; last_seen_at: Date; changed_at: Date; missing_count: number;
  /** Open price anomaly (#1049); only the Başbuğ list selects it. */
  price_anomaly?: boolean;
  sale_price_kurus: number | null; sale_available: boolean | null; sale_stock_label: string | null;
};

export async function adminBasbugData(params: BasbugParams) {
  await requireAdmin();
  const company = process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const group = params.group || "";
  const values: unknown[] = [company];
  const conditions = ["supplier='basbug'", "company=$1", "warehouse='MRK'"];
  if (group) { values.push(group); conditions.push("list_group=$2"); }
  const presence = ["pending_missing", "inactive", "all"].includes(params.presence ?? "") ? params.presence : "present";
  if (presence !== "all") { values.push(presence!); conditions.push(`presence=$${values.length}`); }
  const add = (clause: string, value: string) => { values.push(value); conditions.push(clause.replaceAll("?", `$${values.length}`)); };
  const q = params.q?.trim().slice(0, 120);
  // Same engine as the storefront: word prefixes in name/brand/code/OEM, part numbers with any spacing.
  if (q) conditions.push(supplierItemMatch("supplier_items", parseSearchQuery(q), binder(values)));
  if (params.brand) add("product_data->>'uk'=?", params.brand.slice(0, 200));
  if (params.currency) add("product_data->>'dc'=?", params.currency.slice(0, 20));
  if (["1", "0", "unknown"].includes(params.stock ?? "")) {
    values.push(basbugWarehouse(params.warehouse));
    const depot = `$${values.length}::text`;
    const stock = `COALESCE(stock_data->'depolar'->${depot}->>'stok',CASE WHEN ${depot}='MRK' THEN stock_data->>'stok' END)::numeric`;
    conditions.push(params.stock === "unknown" ? `${stock} IS NULL` : `${stock}${params.stock === "1" ? ">0" : "<=0"}`);
  }
  if (params.quality === "missing-price") conditions.push("price_data IS NULL");
  if (params.quality === "duplicates") conditions.push("(product_count>1 OR price_count>1 OR stock_count>1)");
  if (params.quality === "conflicts") conditions.push("conflicting");
  if (params.quality === "price-anomaly") conditions.push(openPriceAnomalyFilter);
  const where = conditions.join(" AND ");
  // Every read needs only the company and the URL, except the schedule row, which follows the latest snapshot.
  const summaries = db.query<ImportSummary>(
    `SELECT DISTINCT ON (company,list_group,warehouse) * FROM supplier_imports
     WHERE supplier='basbug' AND company=$1 AND status='succeeded' ORDER BY company,list_group,warehouse,completed_at DESC,id DESC`,
    [company],
  ).then(result => {
    const snapshots = result.rows;
    const snapshot = snapshots.filter(i => (!group || i.list_group === group) && i.warehouse === "MRK").sort((a,b) => b.completed_at.getTime() - a.completed_at.getTime())[0];
    return { snapshots, snapshot };
  });
  const [{ snapshots, snapshot }, sync, recentRuns, lastSucceeded, health, facets, list, openPriceAnomalies] = await Promise.all([
    summaries,
    summaries.then(async ({ snapshot }) => snapshot ? (await db.query<{ stale_minutes: number; consecutive_failures: number; next_run_at: Date; enabled: boolean }>(
      "SELECT * FROM supplier_sync_scopes WHERE supplier='basbug' AND company=$1 AND list_group=$2 AND warehouse='MRK'", [snapshot.company,snapshot.list_group],
    )).rows[0] : undefined),
    db.query<ImportSummary>(
      "SELECT * FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND ($2='' OR list_group=$2) AND warehouse='MRK' ORDER BY started_at DESC,id DESC LIMIT $3",
      [company, group, supplierRunHistoryLimit],
    ).then(result => result.rows),
    // Latest succeeded run of any kind (full list or price · stock · rate) in the page's scope.
    db.query<ImportSummary>(
      "SELECT * FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND ($2='' OR list_group=$2) AND warehouse='MRK' AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1",
      [company, group],
    ).then(result => result.rows[0]),
    supplierHealth(db, company),
    // Brand and currency filter options from one scan: the few distinct (brand, currency) pairs, then each column's values.
    db.query<{ brands: string[]; currencies: string[] }>(`WITH pairs AS (
        SELECT product_data->>'uk' AS brand,product_data->>'dc' AS currency FROM supplier_items
        WHERE supplier='basbug' AND company=$1 AND ($2='' OR list_group=$2) AND warehouse='MRK' AND presence='present' GROUP BY 1,2
      ) SELECT ARRAY(SELECT DISTINCT brand FROM pairs ORDER BY 1) AS brands,ARRAY(SELECT DISTINCT currency FROM pairs ORDER BY 1) AS currencies`,
      [company, group],
    ).then(result => result.rows[0]),
    supplierItemPage<AdminSupplierItem>({ where, values, order: sortOrder(params, itemSorts, "code,id"), page: params.page,
      select: "supplier_items.*,EXISTS(SELECT 1 FROM supplier_price_anomalies a WHERE a.supplier_item_id=supplier_items.id AND a.status='open') AS price_anomaly" }),
    openPriceAnomalyCount(db, { company, group }),
  ]);
  const latest = snapshots.reduce<ImportSummary | undefined>((current, item) => !current || item.completed_at > current.completed_at ? item : current, undefined);
  const stale = health.scopes.some(scope => (!group || scope.list_group===group) && (scope.catalog_stale || scope.commerce_stale));
  const knownGroups = latest?.groups_data.malzemeGruplariListesi ?? [{ kod: "FIAT", ad: "FIAT" }];
  if (!snapshot) return { snapshots, snapshot, group, knownGroups, sync, stale, health, recentRuns, lastSucceeded, openPriceAnomalies, items: [] as AdminSupplierItem[], brands: [] as string[], currencies: [] as string[], total: 0, page: 1, pages: 1, capped: false };
  return { snapshots, snapshot, group, knownGroups, sync, stale, health, recentRuns, lastSucceeded, openPriceAnomalies, ...list, brands: facets.brands, currencies: facets.currencies };
}

export async function adminBasbugItem(id: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;
  // Everything below needs only the id, so the detail page waits for one round of queries.
  const [result, changes, sale, pricing, anomaly] = await Promise.all([
    db.query<AdminSupplierItem & { list_group: string; warehouse: string; completed_at: Date }>(
      `SELECT i.*,i.last_seen_at AS completed_at FROM supplier_items i WHERE i.id=$1 AND i.supplier='basbug'`, [id],
    ),
    db.query<SupplierChange>("SELECT * FROM supplier_item_changes WHERE item_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 20", [id]),
    getProduct(id), adminProductPricing(id),
    // A price anomaly (#1030, #1050) keeps the offer unpriced while open.
    db.query<{ kind: PriceAnomalyKind; status: "open" | "dismissed"; evidence: PriceAnomalyEvidence }>("SELECT kind,status,evidence FROM supplier_price_anomalies WHERE supplier_item_id=$1", [id]),
  ]);
  const item = result.rows[0];
  return item ? { ...item, changes: changes.rows, sale, pricing, anomaly: anomaly.rows[0] ?? null } : null;
}
