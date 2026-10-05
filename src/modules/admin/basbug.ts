import "server-only";
import { requireAdmin } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { supplierHealth } from "@/modules/suppliers/health";
import { z } from "zod";

export type BasbugParams = { q?: string; group?: string; brand?: string; currency?: string; stock?: string; quality?: string; presence?: string; page?: string; updated?: string; error?: string };
export type ImportSummary = {
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
  stock_data: { stok: number; sYol: number; sDepo: string; sFarkliDepo: number } | null;
  product_count: number; price_count: number; stock_count: number; conflicting: boolean;
  source_variants: Record<string, unknown>;
  presence: "present" | "pending_missing" | "inactive";
  first_seen_at: Date; last_seen_at: Date; changed_at: Date; missing_count: number;
};

export async function adminBasbugData(params: BasbugParams) {
  await requireAdmin();
  const summaries = await db.query<ImportSummary>(
    `SELECT DISTINCT ON (company,list_group,warehouse) * FROM supplier_imports
     WHERE supplier='basbug' AND company=$1 AND status='succeeded' ORDER BY company,list_group,warehouse,completed_at DESC,id DESC`,
    [process.env.BASBUG_FIRMA_ADI || "BASBUG"],
  );
  const snapshots = summaries.rows;
  const group = params.group || "";
  const snapshot = snapshots.filter(i => (!group || i.list_group === group) && i.warehouse === "MRK").sort((a,b) => b.completed_at.getTime() - a.completed_at.getTime())[0];
  const latest = snapshots.reduce<ImportSummary | undefined>((current, item) => !current || item.completed_at > current.completed_at ? item : current, undefined);
  const sync = snapshot ? (await db.query<{ stale_minutes: number; consecutive_failures: number; next_run_at: Date; enabled: boolean }>(
    "SELECT * FROM supplier_sync_scopes WHERE supplier='basbug' AND company=$1 AND list_group=$2 AND warehouse='MRK'", [snapshot.company,snapshot.list_group],
  )).rows[0] : undefined;
  const recentRuns = (await db.query<ImportSummary>(
    "SELECT * FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND ($2='' OR list_group=$2) AND warehouse='MRK' ORDER BY started_at DESC,id DESC LIMIT 10",
    [process.env.BASBUG_FIRMA_ADI || "BASBUG", group],
  )).rows;
  const health = await supplierHealth(db, process.env.BASBUG_FIRMA_ADI || "BASBUG");
  const stale = health.scopes.some(scope => (!group || scope.list_group===group) && (scope.catalog_stale || scope.commerce_stale));
  const knownGroups = latest?.groups_data.malzemeGruplariListesi ?? [{ kod: "FIAT", ad: "FIAT" }];
  if (!snapshot) return { snapshots, snapshot, group, knownGroups, sync, stale, health, recentRuns, items: [] as AdminSupplierItem[], brands: [] as string[], currencies: [] as string[], total: 0, page: 1, pages: 1 };
  const values: (string | number)[] = [snapshot.company];
  const conditions = ["supplier='basbug'", "company=$1", "warehouse='MRK'"];
  if (group) { values.push(group); conditions.push("list_group=$2"); }
  const presence = ["pending_missing", "inactive", "all"].includes(params.presence ?? "") ? params.presence : "present";
  if (presence !== "all") { values.push(presence!); conditions.push(`presence=$${values.length}`); }
  const add = (clause: string, value: string) => { values.push(value); conditions.push(clause.replaceAll("?", `$${values.length}`)); };
  const q = params.q?.trim().slice(0, 120);
  if (q) add("(code ILIKE ? ESCAPE '\\' OR product_data->>'ac' ILIKE ? ESCAPE '\\' OR product_data->>'oe' ILIKE ? ESCAPE '\\' OR product_data->>'uk' ILIKE ? ESCAPE '\\')", `%${q.replace(/[\\%_]/g, "\\$&")}%`);
  if (params.brand) add("product_data->>'uk'=?", params.brand.slice(0, 200));
  if (params.currency) add("product_data->>'dc'=?", params.currency.slice(0, 20));
  if (params.stock === "1" || params.stock === "0") add("stock_data->>'stok'=?", params.stock);
  if (params.quality === "missing-price") conditions.push("price_data IS NULL");
  if (params.quality === "duplicates") conditions.push("(product_count>1 OR price_count>1 OR stock_count>1)");
  if (params.quality === "conflicts") conditions.push("conflicting");
  const where = conditions.join(" AND ");
  const [count, brands, currencies] = await Promise.all([
    db.query<{ count: string }>(`SELECT count(*) FROM supplier_items WHERE ${where}`, values),
    db.query<{ value: string }>("SELECT DISTINCT product_data->>'uk' AS value FROM supplier_items WHERE supplier='basbug' AND company=$1 AND ($2='' OR list_group=$2) AND warehouse='MRK' AND presence='present' ORDER BY value", [snapshot.company,group]),
    db.query<{ value: string }>("SELECT DISTINCT product_data->>'dc' AS value FROM supplier_items WHERE supplier='basbug' AND company=$1 AND ($2='' OR list_group=$2) AND warehouse='MRK' AND presence='present' ORDER BY value", [snapshot.company,group]),
  ]);
  const total = Number(count.rows[0].count), pages = Math.max(1, Math.ceil(total / 50));
  const parsedPage = Number(params.page);
  const page = Number.isSafeInteger(parsedPage) ? Math.min(pages, Math.max(1, parsedPage)) : 1;
  const items = await db.query<AdminSupplierItem>(`SELECT * FROM supplier_items WHERE ${where} ORDER BY code,id LIMIT 50 OFFSET $${values.length + 1}`, [...values, (page - 1) * 50]);
  return { snapshots, snapshot, group, knownGroups, sync, stale, health, recentRuns, items: items.rows, brands: brands.rows.map(r => r.value), currencies: currencies.rows.map(r => r.value), total, page, pages };
}

export async function adminBasbugItem(id: string) {
  await requireAdmin();
  if (!z.uuid().safeParse(id).success) return null;
  const result = await db.query<AdminSupplierItem & { list_group: string; warehouse: string; completed_at: Date }>(
    `SELECT i.*,i.last_seen_at AS completed_at FROM supplier_items i WHERE i.id=$1 AND i.supplier='basbug'`, [id],
  );
  const item = result.rows[0];
  if (!item) return null;
  const changes = (await db.query<{ id: string; changed_at: Date; kind: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> }>(
    "SELECT * FROM supplier_item_changes WHERE item_id=$1 ORDER BY changed_at DESC,id DESC LIMIT 20", [id],
  )).rows;
  return { ...item, changes };
}
