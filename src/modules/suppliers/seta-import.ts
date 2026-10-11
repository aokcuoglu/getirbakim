import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Pool } from "pg";
import { canonical } from "./basbug-import";
import { setaCompany } from "./storefront-sources";
import { applySupplierSnapshot, rejectionReason, type ObservationItem } from "./sync";

// SETA (Seta Filtre) publishes its whole B2B list from one endpoint: GET /seta/products with an XApiKey header.
// No groups, warehouses, paging or currencies: one fixed scope covers the list.
export const setaScope = { supplier: "seta", company: setaCompany, group: "ALL", warehouse: "MAIN" } as const;
export const setaBrand = "SETA";

// Verified against the live response (2026-10-11, 1.392 rows). `brand` is the vehicle make, not the part maker;
// `price` is the dealer purchase price excluding VAT; `stock` is availability, not a quantity; `cross` is an
// object of competitor references or an empty array.
const rowSchema = z.object({
  product_no: z.string().trim().min(1).max(120), product_name: z.string(),
  price: z.string().regex(/^\d+(\.\d+)?$/), currency: z.literal("TRY"), stock: z.boolean(),
  image: z.string(), oems: z.array(z.string()), category: z.string().nullable(), brand: z.string().nullable(),
  cross: z.union([z.record(z.string(), z.string()), z.tuple([])]),
}).passthrough();
export type SetaRow = z.infer<typeof rowSchema>;
const optionsSchema = z.object({ mode: z.enum(["full", "commerce"]).default("full"), acceptAnomaly: z.string().trim().min(10).max(500).optional() });

export class SetaImportError extends Error {
  constructor(public readonly reason: "busy" | "upstream" | "contract" | "config" | "rejected" | "paused", public readonly detail?: string) {
    super(`SETA: ${reason}${detail ? ` (${detail})` : ""}`);
  }
}

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

// Storefront, search and enrichment read Başbuğ's field names (ac name, ac2 description, uk brand, oe OEMs,
// dc currency, nf cost, stok availability), so SETA rows are written in that shape next to their own fields.
// A few rows arrive without a category; SETA's code prefixes are consistent with it across the list.
const prefixCategories: Record<string, string> = { STA: "Hava Filtreleri", STO: "Yağ Filtreleri", STF: "Yakıt Filtreleri", STC: "Polen Filtreleri" };

export function setaProductData(row: SetaRow) {
  const category = row.category ? squash(row.category) : prefixCategories[row.product_no.split("-")[0]] ?? "";
  const application = squash(row.product_name);
  const named = !category || category.toLocaleLowerCase("tr") === "yedek parça";
  const ac = named ? application || row.product_no : category.replace(/Filtreleri$/, "Filtresi").replace(/^Kurutucular$/, "Kurutucu");
  return {
    no: row.product_no, ac, ac2: ac === application ? "" : application, uk: setaBrand,
    oe: row.oems.map(squash).filter(Boolean).join(" / "), dc: row.currency,
    // Legacy storefront category keys (src/modules/store/category-tree.ts).
    category: /filtre/i.test(category) ? "filtre" : named && category ? "yedek-parca" : null,
    product_name: row.product_name, source_category: row.category, vehicle_brand: row.brand,
    oems: row.oems, cross: Array.isArray(row.cross) ? {} : row.cross, image: row.image,
  };
}

export function prepareSetaImport(input: unknown) {
  const rows = z.array(rowSchema).min(1).parse(input);
  const byCode = new Map<string, { rows: SetaRow[]; keys: Set<string> }>();
  for (const row of rows) {
    const entry = byCode.get(row.product_no) ?? { rows: [], keys: new Set<string>() };
    entry.rows.push(row); entry.keys.add(canonical(row));
    byCode.set(row.product_no, entry);
  }
  const items: ObservationItem[] = [...byCode].map(([code, { rows: variants, keys }]) => {
    const row = variants[0];
    const cost = Number(row.price);
    // A zero price means "no price" upstream; it must not become a free product.
    const price_data = cost > 0 ? { nf: cost, price: row.price } : null;
    return {
      code, product_data: setaProductData(row), price_data, stock_data: { stok: row.stock ? 1 : 0 },
      product_count: variants.length, price_count: price_data ? variants.length : 0, stock_count: variants.length,
      conflicting: keys.size > 1, source_variants: keys.size > 1 ? { products: variants } : {},
    };
  });
  return { items, quality: {
    productRows: rows.length, priceRows: rows.filter(row => Number(row.price) > 0).length, stockRows: rows.length,
    uniqueProducts: items.length, missingPrices: items.filter(i => !i.price_data).length, missingStocks: 0,
    outOfStock: items.filter(i => i.stock_data?.stok === 0).length,
    duplicateCodes: items.filter(i => i.product_count > 1).length,
    conflictingCodes: items.filter(i => i.conflicting).length, orphanPrices: 0, orphanStocks: 0,
  } };
}

function endpoint() {
  const key = process.env.SETA_API_KEY;
  if (!key) throw new SetaImportError("config");
  let url: URL;
  try { url = new URL(process.env.SETA_BASE_URL || "https://b2b-api.ismyazilim.com/seta/products"); }
  catch { throw new SetaImportError("config"); }
  if (url.protocol !== "https:" || url.hostname !== "b2b-api.ismyazilim.com" || url.username || url.password) throw new SetaImportError("config");
  return { url, key };
}

const paused = () => existsSync(resolve(".local/seta-paused"));

// Full: discovers products and advances missing/inactive counters. Commerce: the same single request,
// applied only to codes already present, keeping their product fields (product changes belong to full runs).
export async function importSeta(pool: Pool, options: z.input<typeof optionsSchema> = {}, progress?: (stage: string) => void) {
  if (paused()) throw new SetaImportError("paused");
  const { mode, acceptAnomaly } = optionsSchema.parse(options);
  const { supplier, company, group, warehouse } = setaScope;
  const connection = await pool.connect();
  let locked = false;
  let inTransaction = false;
  let stage = "Bağlantı";
  let runId: string | undefined;
  const observations: Record<string, string> = {};
  try {
    // Separate from Başbuğ's lock: a long Başbuğ run must not block SETA checkouts. db:setup takes both.
    locked = (await connection.query("SELECT pg_try_advisory_lock(20261001, 4) AS locked")).rows[0].locked;
    if (!locked) throw new SetaImportError("busy");
    runId = (await connection.query<{ id: string }>(
      `INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,status,observations,quality,groups_data,currencies_data,run_kind)
       VALUES($1,$2,$3,$4,$5,'running','{}','{}','{}','{}',$6) RETURNING id`, [supplier,company,group,warehouse,new Date(),mode],
    )).rows[0].id;
    await connection.query(`UPDATE supplier_imports SET status='failed',completed_at=clock_timestamp(),error_reason='worker-interrupted'
      WHERE supplier=$1 AND status='running' AND id<>$2`, [supplier,runId]);
    stage = "Config";
    const { url, key } = endpoint();
    const baseline = mode === "commerce" ? (await connection.query<{ observations: Record<string,string> }>(
      `SELECT observations FROM supplier_imports WHERE supplier=$1 AND company=$2 AND list_group=$3 AND warehouse=$4
       AND status='succeeded' AND run_kind='full' ORDER BY completed_at DESC,id DESC LIMIT 1`, [supplier,company,group,warehouse])).rows[0] : undefined;
    if (mode === "commerce" && !baseline) throw new SetaImportError("config", "initial full import required");
    stage = "products";
    progress?.(stage);
    if (paused()) throw new SetaImportError("paused");
    const response = await fetch(url, { headers: { XApiKey: key, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new SetaImportError("upstream", `products HTTP ${response.status}`);
    const data: unknown = await response.json();
    observations.products = new Date().toISOString();
    const prepared = prepareSetaImport(data);
    if (mode === "commerce") {
      const existing = new Map((await connection.query<{ code: string; product_data: Record<string, unknown>; product_count: number; source_variants: Record<string, unknown> }>(
        `SELECT code,product_data,product_count,source_variants FROM supplier_items WHERE supplier=$1 AND company=$2 AND list_group=$3
         AND warehouse=$4 AND presence='present'`, [supplier,company,group,warehouse])).rows.map(row => [row.code,row]));
      prepared.items = prepared.items.filter(item => existing.has(item.code)).map(item => {
        const old = existing.get(item.code)!;
        return { ...item, product_data: old.product_data, product_count: old.product_count,
          conflicting: item.conflicting || Boolean(old.source_variants.products),
          source_variants: old.source_variants.products ? { ...item.source_variants, products: old.source_variants.products } : item.source_variants };
      });
      if (!prepared.items.length) throw new SetaImportError("contract");
      Object.assign(prepared.quality, {
        uniqueProducts: prepared.items.length, missingPrices: prepared.items.filter(i => !i.price_data).length,
        outOfStock: prepared.items.filter(i => i.stock_data?.stok === 0).length,
        conflictingCodes: prepared.items.filter(i => i.conflicting).length,
      });
      if (baseline!.observations.products) observations.catalog = baseline!.observations.products;
    }
    stage = "DB";
    progress?.(stage);
    await connection.query("BEGIN"); inTransaction = true;
    const previous = (await connection.query<{ quality: typeof prepared.quality }>(
      `SELECT quality FROM supplier_imports WHERE supplier=$1 AND company=$2 AND list_group=$3 AND warehouse=$4
       AND status='succeeded' AND ($5='commerce' OR run_kind='full') ORDER BY completed_at DESC,id DESC LIMIT 1`, [supplier,company,group,warehouse,mode],
    )).rows[0]?.quality;
    // Commerce covers known present codes only; compare missing-price ratios, not the list size.
    const comparison = mode === "commerce" && previous?.uniqueProducts ? { ...previous, uniqueProducts: prepared.quality.uniqueProducts,
      missingPrices: previous.missingPrices / previous.uniqueProducts * prepared.quality.uniqueProducts, missingStocks: 0 } : previous;
    const rejection = rejectionReason(prepared.quality, comparison);
    if (rejection && !acceptAnomaly) {
      await connection.query("ROLLBACK"); inTransaction = false;
      await connection.query("UPDATE supplier_imports SET quality=$2,observations=$3,error_reason=$4 WHERE id=$1",
        [runId,JSON.stringify(prepared.quality),JSON.stringify(observations),rejection]);
      throw new SetaImportError("rejected", rejection);
    }
    const observedAt = new Date();
    const stats = await applySupplierSnapshot(connection, setaScope, runId, prepared.items, observedAt, mode === "full");
    await connection.query(`UPDATE supplier_imports SET status='succeeded',completed_at=$2,observations=$3,quality=$4,stats=$5,review_note=$6 WHERE id=$1`,
      [runId,observedAt,JSON.stringify(observations),JSON.stringify(prepared.quality),JSON.stringify(stats),acceptAnomaly ?? null]);
    if (mode === "full") {
      await connection.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,last_success_at,next_run_at)
        VALUES($1,$2,$3,$4,true,$5,((($5::timestamptz AT TIME ZONE 'Europe/Istanbul')::date+1)+time '03:00') AT TIME ZONE 'Europe/Istanbul') ON CONFLICT(supplier,company,list_group,warehouse)
        DO UPDATE SET last_success_at=$5,consecutive_failures=0,next_run_at=CASE WHEN supplier_sync_scopes.interval_minutes=1440 THEN
          ((($5::timestamptz AT TIME ZONE 'Europe/Istanbul')::date+1)+supplier_sync_scopes.daily_at) AT TIME ZONE 'Europe/Istanbul'
          ELSE $5::timestamptz+supplier_sync_scopes.interval_minutes*interval '1 minute' END`, [supplier,company,group,warehouse,observedAt]);
    }
    await connection.query(`UPDATE supplier_sync_scopes SET commerce_last_success_at=$5,commerce_failures=0,
      commerce_next_run_at=$5::timestamptz+commerce_interval_minutes*interval '1 minute'
      WHERE supplier=$1 AND company=$2 AND list_group=$3 AND warehouse=$4`, [supplier,company,group,warehouse,observedAt]);
    await connection.query("COMMIT"); inTransaction = false;
    return { id: runId, ...prepared.quality, stats };
  } catch (error) {
    if (inTransaction) await connection.query("ROLLBACK");
    if (runId) {
      const reason = error instanceof SetaImportError ? error.reason : error instanceof z.ZodError ? "contract" : "upstream";
      // Persist only controlled diagnostics, never response bodies, keys or raw exception messages.
      const diagnostic = error instanceof Error && error.name === "TimeoutError" ? "timeout"
        : error instanceof SetaImportError ? error.detail?.match(/HTTP \d{3}$/)?.[0] : undefined;
      await connection.query(`UPDATE supplier_imports SET status=$2,completed_at=clock_timestamp(),observations=$3,
        error_reason=COALESCE(error_reason,$4) WHERE id=$1`, [runId,reason === "rejected" ? "rejected" : "failed",JSON.stringify(observations),`${reason}: ${stage}${diagnostic ? `: ${diagnostic}` : ""}`]);
      if (mode === "commerce") {
        await connection.query(`UPDATE supplier_sync_scopes SET commerce_failures=commerce_failures+1,
          commerce_next_run_at=now()+LEAST(360,15*power(2,LEAST(commerce_failures,5))) * interval '1 minute'
          WHERE supplier=$1 AND company=$2 AND list_group=$3 AND warehouse=$4`, [supplier,company,group,warehouse]);
      } else {
        await connection.query(`INSERT INTO supplier_sync_scopes(supplier,company,list_group,warehouse,enabled,consecutive_failures,next_run_at)
        VALUES($1,$2,$3,$4,true,1,now()+interval '15 minutes') ON CONFLICT(supplier,company,list_group,warehouse)
        DO UPDATE SET consecutive_failures=supplier_sync_scopes.consecutive_failures+1,
        next_run_at=now()+LEAST(360,15*power(2,LEAST(supplier_sync_scopes.consecutive_failures,5))) * interval '1 minute'`, [supplier,company,group,warehouse]);
      }
    }
    if (error instanceof SetaImportError) throw error;
    if (error instanceof z.ZodError) throw new SetaImportError("contract");
    const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]{5,40}$/.test(error.code) ? ` ${error.code}` : "";
    throw new SetaImportError("upstream", `${stage}${code}`);
  } finally {
    try {
      if (locked) await connection.query("SELECT pg_advisory_unlock(20261001, 4)");
    } finally {
      connection.release();
    }
  }
}
