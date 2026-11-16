import { z } from "zod";
import type { Pool } from "pg";
import { BasbugImportError, basbugBase, basbugLogin, basbugPaused } from "./basbug-import";
import { supplierFetch } from "./egress-proxy";

/**
 * Checkout-time check of just the cart's Başbuğ rows through the per-code MalzemeAra endpoint (verified 16 Nov 2026:
 * one JSON object per code with nf/mif/k and depot stocks sMrk/sIzm/sAnk/sAdn/sErz; HTTP 604 "Malzeme bulunamadı!"
 * for a code the supplier no longer knows, so the code is sent exactly as stored). Like refreshDinamikItems it takes no
 * import lock: a second login does not invalidate a running import's token, and no database connection is held while
 * waiting. Only price and depot stock change here; presence and product data stay with the list imports.
 *
 * Any depot can supply an order, so availability is cumulative: MalzemeAra's depots (MRK, IZM, ANK, ADN, ERZ) differ
 * from StokGetir's (MRK, IZM, IAN, KYS, TRK); depots it does not return keep their saved stock, and sFarkliDepo is
 * recomputed over every depot except MRK. sYol (in transit) is not a depot and never counts.
 */

const basbugItemSchema = z.object({
  no: z.string().min(1), nf: z.number().finite(), mif: z.number().finite(), k: z.number().finite(),
  sMrk: z.number().finite(), sIzm: z.number().finite(), sAnk: z.number().finite(), sAdn: z.number().finite(), sErz: z.number().finite(),
}).passthrough();

/** Why a cart line could not be confirmed live; the order then sells it on its saved data and marks the line. */
export type FallbackReason = "timeout" | "upstream" | "busy" | "paused" | "config" | "contract";
const fallbackReasons: readonly string[] = ["timeout", "upstream", "busy", "paused", "config", "contract"] satisfies FallbackReason[];
const isFallbackReason = (value: unknown): value is FallbackReason => typeof value === "string" && fallbackReasons.includes(value);

/** Maps a supplier error (Başbuğ, SETA and Dinamik errors all carry `reason`) to a line marker; "rejected" and unknown errors are upstream. */
export function fallbackReason(error: unknown): FallbackReason {
  if (typeof error !== "object" || error === null) return "upstream";
  if ("name" in error && error.name === "TimeoutError") return "timeout";
  return "reason" in error && isFallbackReason(error.reason) ? error.reason : "upstream";
}

/** The MalzemeAra answer for `code`: price_data fields as the list imports store them and the stock per depot (depolar keys). */
export function prepareBasbugItemCheck(code: string, response: unknown) {
  const item = basbugItemSchema.parse(response);
  if (item.no !== code) throw new BasbugImportError("contract", "MalzemeNo");
  return { price: { no: item.no, nf: item.nf, mif: item.mif, k: item.k }, depots: { MRK: item.sMrk, IZM: item.sIzm, ANK: item.sAnk, ADN: item.sAdn, ERZ: item.sErz } };
}

export type BasbugItemFetch = (company: string, code: string) => Promise<{ status: number; json(): Promise<unknown> }>;

type Session = { token: string; expires: number };
// Shared by checkouts in this process; a token lives 300 s and is renewed 30 s before it expires.
let session: Session | undefined;
let pendingLogin: Promise<Session> | undefined;

/** MalzemeAra over the egress proxy with a cached token; a login failure fails every later call of this client the same way. */
export function basbugItemClient(): BasbugItemFetch {
  const base = basbugBase();
  let loginFailure: { error: unknown } | undefined;
  async function token(stale?: string) {
    if (loginFailure) throw loginFailure.error;
    if (session && session.token !== stale && Date.now() < session.expires - 30_000) return session.token;
    pendingLogin ??= basbugLogin(base, 5_000).finally(() => { pendingLogin = undefined; });
    try { session = await pendingLogin; }
    catch (error) { loginFailure = { error }; throw error; }
    return session.token;
  }
  async function request(company: string, code: string, bearer: string) {
    const url = new URL("/material/MalzemeAra", base);
    url.search = new URLSearchParams({ FirmaAdi: company, MalzemeNo: code }).toString();
    return supplierFetch("basbug", url, { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000) });
  }
  return async (company, code) => {
    const bearer = await token();
    const response = await request(company, code, bearer);
    if (response.status !== 401) return response;
    // The token expired or was revoked early: log in again once.
    return request(company, code, await token(bearer));
  };
}

type Observed = { id: string; gone: boolean; nf?: number; mif?: number; k?: number; depots?: Record<string, number> };

export async function refreshBasbugItems(pool: Pool, ids: string[], options: { fetchItem?: BasbugItemFetch; budgetMs?: number } = {}) {
  const failed: Record<string, FallbackReason> = {};
  const result = { refreshed: 0, changed: 0, gone: [] as string[], failed };
  if (!ids.length) return result;
  if (basbugPaused()) {
    for (const id of ids) failed[id] = "paused";
    return result;
  }
  const rows = (await pool.query<{ id: string; code: string; company: string }>(
    "SELECT id::text,code,company FROM supplier_items WHERE supplier='basbug' AND warehouse='MRK' AND id=ANY($1::uuid[]) ORDER BY id", [ids])).rows;
  let fetchItem: BasbugItemFetch;
  try { fetchItem = options.fetchItem ?? basbugItemClient(); }
  catch (error) {
    for (const row of rows) failed[row.id] = fallbackReason(error);
    return result;
  }
  const deadline = Date.now() + (options.budgetMs ?? 8_000);
  const observed: Observed[] = [];
  // A few at a time: carts are small, and the API serves one code per request.
  for (let index = 0; index < rows.length; index += 4) {
    const slice = rows.slice(index, index + 4);
    if (Date.now() >= deadline) {
      for (const row of slice) failed[row.id] = "timeout";
      continue;
    }
    await Promise.all(slice.map(async row => {
      try {
        const response = await fetchItem(row.company, row.code);
        // 604's body is plain text ("Malzeme bulunamadı!"), not JSON.
        if (response.status === 604) { observed.push({ id: row.id, gone: true }); return; }
        if (response.status !== 200) throw new BasbugImportError("upstream", `MalzemeAra HTTP ${response.status}`);
        const item = prepareBasbugItemCheck(row.code, await response.json());
        observed.push({ id: row.id, gone: false, ...item.price, depots: item.depots });
      } catch (error) {
        failed[row.id] = error instanceof z.ZodError ? "contract" : fallbackReason(error);
      }
    }));
  }
  if (!observed.length) return result;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Merged onto the current row: sYol and the depots MalzemeAra does not return keep their list values; stok is MRK
    // and sFarkliDepo the sum over every other depot after the merge. A code the supplier no longer knows is out of
    // stock in every depot until a list import decides its presence.
    // product_data is not written, so the enrichment and search triggers (UPDATE OF code,product_data) stay quiet.
    const changed = await client.query(`WITH incoming AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,gone boolean,nf numeric,mif numeric,k numeric,depots jsonb)),
      existing AS (
        SELECT o.id,o.code,o.price_data,n.gone,n.nf,n.mif,n.k,n.depots,
          COALESCE(o.stock_data,'{"sDepo":"MRK","sYol":0,"sFarkliDepo":0}'::jsonb) AS stock,
          COALESCE(o.stock_data->'depolar','{}'::jsonb) AS saved
        FROM supplier_items o JOIN incoming n ON n.id=o.id),
      observed AS (
        SELECT id,stock,CASE WHEN gone THEN price_data
            ELSE COALESCE(price_data,'{}'::jsonb)||jsonb_build_object('no',code,'nf',nf,'mif',mif,'k',k) END AS price_data,
          CASE WHEN gone
            THEN (SELECT COALESCE(jsonb_object_agg(d.key,d.value||'{"stok":0}'::jsonb),'{}'::jsonb) FROM jsonb_each(saved) d)
              ||jsonb_build_object('MRK',COALESCE(saved->'MRK','{"sYol":0}'::jsonb)||'{"stok":0}'::jsonb)
            ELSE saved||(SELECT jsonb_object_agg(d.key,COALESCE(saved->d.key,'{"sYol":0}'::jsonb)||jsonb_build_object('stok',d.value)) FROM jsonb_each(depots) d)
          END AS depolar
        FROM existing),
      merged AS (
        SELECT id,price_data,stock||jsonb_build_object('stok',COALESCE((depolar#>>'{MRK,stok}')::numeric,0),
          'sFarkliDepo',(SELECT COALESCE(sum((d.value->>'stok')::numeric),0) FROM jsonb_each(depolar) d WHERE d.key<>'MRK'),
          'depolar',depolar) AS stock_data
        FROM observed),
      -- CTEs share the statement's snapshot, so this still reads the values before the update.
      before AS (
        SELECT o.id,jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data) AS data
        FROM supplier_items o JOIN merged n ON n.id=o.id
        WHERE ROW(o.price_data,o.stock_data) IS DISTINCT FROM ROW(n.price_data,n.stock_data)),
      updated AS (
        UPDATE supplier_items o SET price_data=n.price_data,stock_data=n.stock_data,last_seen_at=now(),changed_at=now()
        FROM merged n JOIN before b ON b.id=n.id WHERE o.id=n.id
        RETURNING o.id,o.product_data,o.price_data,o.stock_data,o.conflicting,o.source_variants,o.presence)
      INSERT INTO supplier_item_changes(item_id,import_id,changed_at,kind,before_data,after_data)
      SELECT u.id,NULL,now(),'changed',b.data,jsonb_build_object('product',u.product_data,'price',u.price_data,'stock',u.stock_data,
        'conflicting',u.conflicting,'variants',u.source_variants,'presence',u.presence,'source','checkout')
      FROM updated u JOIN before b ON b.id=u.id`, [JSON.stringify(observed)]);
    await client.query("UPDATE supplier_items SET last_seen_at=now() WHERE id=ANY($1::uuid[])", [observed.map(item => item.id)]);
    await client.query("COMMIT");
    result.refreshed = observed.length;
    result.changed = changed.rowCount ?? 0;
    result.gone = observed.filter(item => item.gone).map(item => item.id);
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
