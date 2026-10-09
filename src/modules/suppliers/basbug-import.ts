import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Pool } from "pg";
import { applySupplierSnapshot, rejectionReason } from "./sync";

// Shared by the admin server action and CLI. Never imported by a client component.
const productSchema = z.object({
  no: z.string().min(1), ac: z.string(), ac2: z.string(), uk: z.string(), oe: z.string(),
  lgk: z.string(), m: z.string(), mo: z.string(), y: z.string(), b: z.string(),
  dc: z.string(), lf: z.number().finite(), mkk: z.string(),
}).passthrough();
const priceSchema = z.object({ no: z.string().min(1), nf: z.number().finite(), mif: z.number().finite(), k: z.number().finite() }).passthrough();
const stockSchema = z.object({ no: z.string().min(1), stok: z.number().finite(), sYol: z.number().finite(), sDepo: z.string(), sFarkliDepo: z.number().finite() }).passthrough();
const groupsSchema = z.object({ malzemeGruplariListesi: z.array(z.object({ kod: z.string().min(1), ad: z.string() })) });
const currenciesSchema = z.object({ dovizListesi: z.array(z.object({ dovizCinsi: z.string(), alis: z.string().regex(/^\d+(\.\d+)?$/), satis: z.string().regex(/^\d+(\.\d+)?$/) })) });
const authSchema = z.object({ token: z.string().min(1), tokenTipi: z.literal("Bearer"), tokenBitisSuresi: z.number().positive() });
// Warehouses this account may query; others answer HTTP 607 ("Depo Oncelik bilginiz bulunmamaktadir").
// Values are availability flags (0/1), not quantities.
export const basbugWarehouses = ["MRK", "IZM", "IAN", "TRK"] as const;
export const importOptions = z.object({ mode: z.enum(["full", "commerce"]).default("full"), group: z.string().regex(/^[A-Z0-9_-]{1,30}$/), warehouse: z.literal("MRK"), company: z.string().trim().min(1).max(100).optional(), acceptAnomaly: z.string().trim().min(10).max(500).optional() });

export class BasbugImportError extends Error {
  constructor(public readonly reason: "busy" | "upstream" | "contract" | "config" | "rejected" | "paused", public readonly detail?: string) {
    super(`Başbuğ: ${reason}${detail ? ` (${detail})` : ""}`);
  }
}

function required(key: string) {
  const value = process.env[key];
  if (!value) throw new BasbugImportError("config");
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function indexRows<T extends { no: string }>(rows: T[]) {
  const map = new Map<string, { value: T; count: number; conflicting: boolean; variants: T[]; keys: Set<string> }>();
  for (const value of rows) {
    const previous = map.get(value.no);
    const key = canonical(value);
    if (previous) {
      previous.count++;
      if (!previous.keys.has(key)) {
        previous.keys.add(key); previous.variants.push(value); previous.conflicting = true;
      }
    } else map.set(value.no, { value, count: 1, conflicting: false, variants: [value], keys: new Set([key]) });
  }
  return map;
}

const stockList = z.object({ stokListesi: z.array(stockSchema) });

export function prepareBasbugImport(input: { products: unknown; prices: unknown; stock: unknown; warehouseStocks?: Record<string, unknown> }) {
  const products = z.object({ malzemeListesi: z.array(productSchema).min(1) }).parse(input.products).malzemeListesi;
  const prices = z.object({ fiyatListesi: z.array(priceSchema) }).parse(input.prices).fiyatListesi;
  const stock = stockList.parse(input.stock).stokListesi;
  const p = indexRows(products), f = indexRows(prices), s = indexRows(stock);
  const depots = Object.entries(input.warehouseStocks ?? {}).map(([depot, data]) => [depot, indexRows(stockList.parse(data).stokListesi)] as const);
  const items = [...p].map(([code, product]) => {
    const primary = s.get(code);
    const depotRows = depots.flatMap(([depot, rows]) => rows.has(code) ? [[depot, rows.get(code)!] as const] : []);
    const depotConflicts = Object.fromEntries(depotRows.filter(([, row]) => row.conflicting).map(([depot, row]) => [depot, row.variants]));
    // Per-warehouse flags ride inside stock_data so change history and checkout keep one stock record.
    const stock_data = primary && depots.length
      ? { ...primary.value, depolar: Object.fromEntries(depotRows.map(([depot, row]) => [depot, { stok: row.value.stok, sYol: row.value.sYol }])) }
      : primary?.value ?? null;
    return {
      code, product_data: product.value, price_data: f.get(code)?.value ?? null,
      stock_data, product_count: product.count,
      price_count: f.get(code)?.count ?? 0, stock_count: primary?.count ?? 0,
      conflicting: product.conflicting || Boolean(f.get(code)?.conflicting) || Boolean(primary?.conflicting) || Object.keys(depotConflicts).length > 0,
      source_variants: {
        ...(product.conflicting ? { products: product.variants } : {}),
        ...(f.get(code)?.conflicting ? { prices: f.get(code)!.variants } : {}),
        ...(primary?.conflicting ? { stocks: primary.variants } : {}),
        ...(Object.keys(depotConflicts).length ? { warehouseStocks: depotConflicts } : {}),
      },
    };
  });
  return { items, quality: {
    productRows: products.length, priceRows: prices.length, stockRows: stock.length,
    uniqueProducts: p.size, missingPrices: items.filter(i => !i.price_data).length,
    missingStocks: items.filter(i => !i.stock_data).length,
    duplicateCodes: items.filter(i => i.product_count > 1 || i.price_count > 1 || i.stock_count > 1).length,
    conflictingCodes: items.filter(i => i.conflicting).length,
    orphanPrices: [...f.keys()].filter(k => !p.has(k)).length,
    orphanStocks: [...s.keys()].filter(k => !p.has(k)).length,
  } };
}

export async function importBasbug(pool: Pool, options: z.input<typeof importOptions>, progress?: (stage: string) => void) {
  if (existsSync(resolve(".local/basbug-paused"))) throw new BasbugImportError("paused");
  const { mode, group, warehouse, company: requestedCompany, acceptAnomaly } = importOptions.parse(options);
  const company = requestedCompany || process.env.BASBUG_FIRMA_ADI || "BASBUG";
  const connection = await pool.connect();
  let locked = false;
  let inTransaction = false;
  let stage = "Bağlantı";
  let runId: string | undefined;
  const observations: Record<string, string> = {};
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock(20261001, 1) AS locked")).rows[0].locked;
    if (!locked) throw new BasbugImportError("busy");
    const started = new Date();
    runId = (await connection.query<{ id: string }>(
      `INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,status,observations,quality,groups_data,currencies_data,run_kind)
       VALUES('basbug',$1,$2,$3,$4,'running','{}','{}','{}','{}',$5) RETURNING id`, [company,group,warehouse,started,mode],
    )).rows[0].id;
    // Holding the supplier lock proves older running records have lost their worker.
    await connection.query(`UPDATE supplier_imports SET status='failed',completed_at=clock_timestamp(),error_reason='worker-interrupted'
      WHERE supplier='basbug' AND status='running' AND id<>$1`, [runId]);
    stage = "Config";
    let base: URL;
    try { base = new URL(required("BASBUG_BASE_URL")); }
    catch { throw new BasbugImportError("config"); }
    if (base.protocol !== "https:" || base.hostname !== "api.basbug.com.tr" || base.username || base.password) throw new BasbugImportError("config");
    let token = "", expires = 0;
    async function login() {
      stage = "Auth";
      progress?.("Auth");
      const before = Date.now();
      const result = await fetch(new URL("/auth/Login", base), {
        method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kullaniciAdi: required("BASBUG_USERNAME"), parola: required("BASBUG_PASSWORD"), clientID: required("BASBUG_CLIENT_ID"), clientSecret: required("BASBUG_CLIENT_SECRET") }),
      });
      if (!result.ok) throw new BasbugImportError("upstream", `Auth HTTP ${result.status}`);
      const auth = authSchema.parse(await result.json());
      token = auth.token; expires = before + auth.tokenBitisSuresi * 1000;
    }
    async function get(path: string, params: Record<string, string> = {}) {
      if (existsSync(resolve(".local/basbug-paused"))) throw new BasbugImportError("paused");
      if (Date.now() >= expires - 70_000) await login();
      progress?.(path);
      stage = path;
      const url = new URL(`/material/${path}`, base);
      url.search = new URLSearchParams({ FirmaAdi: company, ...params }).toString();
      const result = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!result.ok) throw new BasbugImportError("upstream", `${path} HTTP ${result.status}`);
      const data: unknown = await result.json();
      observations[path] = new Date().toISOString();
      return data;
    }
    const baseline = mode === "commerce" ? (await connection.query<{
      groups_data: z.infer<typeof groupsSchema>; observations: Record<string,string>;
    }>(`SELECT groups_data,observations FROM supplier_imports WHERE supplier='basbug' AND company=$1
      AND list_group=$2 AND warehouse=$3 AND status='succeeded' AND run_kind='full'
      ORDER BY completed_at DESC,id DESC LIMIT 1`, [company,group,warehouse])).rows[0] : undefined;
    if (mode === "commerce" && !baseline) throw new BasbugImportError("config", "initial full import required");
    const groups = baseline?.groups_data ?? groupsSchema.parse(await get("ListeGrubuGetir"));
    if (!groups.malzemeGruplariListesi.some(g => g.kod === group)) throw new BasbugImportError("contract");
    const existing = mode === "commerce" ? (await connection.query<{
      code:string; product_data:z.infer<typeof productSchema>; product_count:number;
      source_variants: Record<string,unknown>;
    }>(`SELECT code,product_data,product_count,source_variants FROM supplier_items WHERE supplier='basbug'
      AND company=$1 AND list_group=$2 AND warehouse=$3 AND presence='present'`, [company,group,warehouse])).rows : [];
    const products = mode === "full" ? await get("MalzemeleriGetir", { ListeGrubu: group })
      : { malzemeListesi: existing.map(item => item.product_data) };
    if (baseline) {
      // Preserve the actual product/group observation times, never label cached products as fresh.
      if (baseline.observations.MalzemeleriGetir) observations.MalzemeleriGetir = baseline.observations.MalzemeleriGetir;
      if (baseline.observations.ListeGrubuGetir) observations.ListeGrubuGetir = baseline.observations.ListeGrubuGetir;
    }
    const prices = await get("FiyatGetir", { ListeGrubu: group });
    const warehouseStocks: Record<string, unknown> = {};
    for (const depot of basbugWarehouses) {
      const data = await get("StokGetir", { ListeGrubu: group, Depo: depot });
      if (stockList.parse(data).stokListesi.some(row => row.sDepo !== depot)) throw new BasbugImportError("contract");
      warehouseStocks[depot] = data;
    }
    const stock = warehouseStocks[warehouse];
    const currencies = currenciesSchema.parse(await get("DovizBilgisiGetir"));
    const prepared = prepareBasbugImport({ products, prices, stock, warehouseStocks });
    if (mode === "commerce") {
      const byCode = new Map(existing.map(item => [item.code,item]));
      for (const item of prepared.items) {
        const old = byCode.get(item.code)!;
        item.product_count = old.product_count;
        if (old.source_variants.products) {
          item.conflicting = true;
          Object.assign(item.source_variants, { products: old.source_variants.products });
        }
      }
      prepared.quality.productRows = existing.reduce((count,item) => count+item.product_count,0);
      prepared.quality.duplicateCodes = prepared.items.filter(item => item.product_count>1 || item.price_count>1 || item.stock_count>1).length;
      prepared.quality.conflictingCodes = prepared.items.filter(item => item.conflicting).length;
    }
    if (prepared.items.some(i => i.stock_data && i.stock_data.sDepo !== warehouse)) throw new BasbugImportError("contract");
    stage = "DB";
    progress?.(stage);
    await connection.query("BEGIN"); inTransaction = true;
    const previous = (await connection.query<{ quality: typeof prepared.quality }>(
      `SELECT quality FROM supplier_imports WHERE supplier='basbug' AND company=$1 AND list_group=$2 AND warehouse=$3
       AND status='succeeded' AND ($4='commerce' OR run_kind='full') ORDER BY completed_at DESC,id DESC LIMIT 1`, [company,group,warehouse,mode],
    )).rows[0];
    // Commerce only checks known present codes; catalog disappearance is owned by full imports.
    const previousQuality = previous?.quality;
    const comparison = mode === "commerce" && previousQuality?.uniqueProducts ? {
      ...previousQuality, uniqueProducts: prepared.quality.uniqueProducts,
      missingPrices: previousQuality.missingPrices / previousQuality.uniqueProducts * prepared.quality.uniqueProducts,
      missingStocks: previousQuality.missingStocks / previousQuality.uniqueProducts * prepared.quality.uniqueProducts,
    } : previousQuality;
    const rejection = rejectionReason(prepared.quality, comparison);
    if (rejection && !acceptAnomaly) {
      await connection.query("ROLLBACK"); inTransaction = false;
      await connection.query("UPDATE supplier_imports SET quality=$2,observations=$3,groups_data=$4,currencies_data=$5,error_reason=$6 WHERE id=$1",
        [runId,JSON.stringify(prepared.quality),JSON.stringify(observations),JSON.stringify(groups),JSON.stringify(currencies),rejection]);
      throw new BasbugImportError("rejected", rejection);
    }
    const observedAt = new Date();
    const stats = await applySupplierSnapshot(connection, { supplier: "basbug", company, group, warehouse }, runId, prepared.items, observedAt, mode === "full");
    await connection.query(`UPDATE supplier_imports SET status='succeeded',completed_at=$2,observations=$3,quality=$4,groups_data=$5,currencies_data=$6,stats=$7,review_note=$8 WHERE id=$1`,
      [runId,observedAt,JSON.stringify(observations),JSON.stringify(prepared.quality),JSON.stringify(groups),JSON.stringify(currencies),JSON.stringify(stats),acceptAnomaly ?? null]);
    if (mode === "full") {
      await connection.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,last_success_at,next_run_at)
        VALUES('basbug',$1,$2,$3,true,$4,((($4::timestamptz AT TIME ZONE 'Europe/Istanbul')::date+1)+time '03:00') AT TIME ZONE 'Europe/Istanbul') ON CONFLICT(supplier,company,list_group,warehouse)
        DO UPDATE SET last_success_at=$4,consecutive_failures=0,next_run_at=CASE WHEN supplier_sync_scopes.interval_minutes=1440 THEN
          ((($4::timestamptz AT TIME ZONE 'Europe/Istanbul')::date+1)+supplier_sync_scopes.daily_at) AT TIME ZONE 'Europe/Istanbul'
          ELSE $4::timestamptz+supplier_sync_scopes.interval_minutes*interval '1 minute' END`, [company,group,warehouse,observedAt]);
    }
    // A full import also observes prices and stock and satisfies the commercial schedule.
    await connection.query(`UPDATE supplier_sync_scopes SET commerce_last_success_at=$4,commerce_failures=0,
      commerce_next_run_at=$4::timestamptz+commerce_interval_minutes*interval '1 minute'
      WHERE supplier='basbug' AND company=$1 AND list_group=$2 AND warehouse=$3`, [company,group,warehouse,observedAt]);
    await connection.query("COMMIT"); inTransaction = false;
    return { id: runId, ...prepared.quality, stats };
  } catch (error) {
    if (inTransaction) await connection.query("ROLLBACK");
    if (runId) {
      const reason = error instanceof BasbugImportError ? error.reason : error instanceof z.ZodError ? "contract" : "upstream";
      // Persist only controlled diagnostics, never response bodies or raw exception messages.
      const diagnostic = error instanceof Error && error.name === "TimeoutError" ? "timeout"
        : error instanceof BasbugImportError ? error.detail?.match(/HTTP \d{3}$/)?.[0] : undefined;
      await connection.query(`UPDATE supplier_imports SET status=$2,completed_at=clock_timestamp(),observations=$3,
        error_reason=COALESCE(error_reason,$4) WHERE id=$1`, [runId,reason === "rejected" ? "rejected" : "failed",JSON.stringify(observations),`${reason}: ${stage}${diagnostic ? `: ${diagnostic}` : ""}`]);
      if (mode === "commerce") {
        await connection.query(`UPDATE supplier_sync_scopes SET commerce_failures=commerce_failures+1,
          commerce_next_run_at=now()+LEAST(360,15*power(2,LEAST(commerce_failures,5))) * interval '1 minute'
          WHERE supplier='basbug' AND company=$1 AND list_group=$2 AND warehouse=$3`, [company,group,warehouse]);
      } else {
        await connection.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,consecutive_failures,next_run_at)
        VALUES('basbug',$1,$2,$3,true,1,now()+interval '15 minutes') ON CONFLICT(supplier,company,list_group,warehouse)
        DO UPDATE SET consecutive_failures=supplier_sync_scopes.consecutive_failures+1,
        next_run_at=now()+LEAST(360,15*power(2,LEAST(supplier_sync_scopes.consecutive_failures,5))) * interval '1 minute'`, [company,group,warehouse]);
      }
    }
    if (error instanceof BasbugImportError) throw error;
    if (error instanceof z.ZodError) throw new BasbugImportError("contract");
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{5,40}$/.test(error.code) ? ` ${error.code}` : "";
    throw new BasbugImportError("upstream", `${stage}${code}`);
  } finally {
    try {
      if (locked) await connection.query("SELECT pg_advisory_unlock(20261001, 1)");
    } finally {
      connection.release();
    }
  }
}
