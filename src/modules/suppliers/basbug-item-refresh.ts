import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { BasbugImportError, basbugBase, basbugLogin, basbugPaused } from "./basbug-import";
import { supplierFetch } from "./egress-proxy";
import { CHECKOUT_LOCK_TIMEOUT, CHECKOUT_REFRESH_BUDGET_MS, fallbackReason, type FallbackReason } from "./checkout-fallback";

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

/** The MalzemeAra answer for `code`: price_data fields as the list imports store them and the stock per depot (depolar keys). */
export function prepareBasbugItemCheck(code: string, response: unknown) {
  const item = basbugItemSchema.parse(response);
  if (item.no !== code) throw new BasbugImportError("contract", "MalzemeNo");
  return { price: { no: item.no, nf: item.nf, mif: item.mif, k: item.k }, depots: { MRK: item.sMrk, IZM: item.sIzm, ANK: item.sAnk, ADN: item.sAdn, ERZ: item.sErz } };
}

/** One MalzemeAra request; `timeoutMs` is what is left of the check's budget (each request is capped at 5 s anyway). */
export type BasbugItemFetch = (company: string, code: string, timeoutMs?: number) =>
  Promise<{ status: number; json(): Promise<unknown>; body?: { cancel(): Promise<void> } | null }>;

const REQUEST_TIMEOUT_MS = 5_000;
const capped = (timeoutMs = REQUEST_TIMEOUT_MS) => Math.max(1, Math.min(REQUEST_TIMEOUT_MS, timeoutMs));
// A body nobody reads would keep the connection busy; its content is not needed.
const discard = (response: { body?: { cancel(): Promise<void> } | null }) => response.body?.cancel().catch(() => undefined);

type Session = { token: string; expires: number };
// Shared by checkouts in this process; a token lives 300 s and is renewed 30 s before it expires.
let session: Session | undefined;
let pendingLogin: Promise<Session> | undefined;

/** MalzemeAra over the egress proxy with a cached token; a login failure fails every later call of this client the same way. */
export function basbugItemClient(): BasbugItemFetch {
  const base = basbugBase();
  let loginFailure: { error: unknown } | undefined;
  async function token(timeoutMs: number, stale?: string) {
    if (loginFailure) throw loginFailure.error;
    if (session && session.token !== stale && Date.now() < session.expires - 30_000) return session.token;
    pendingLogin ??= basbugLogin(base, timeoutMs).finally(() => { pendingLogin = undefined; });
    try { session = await pendingLogin; }
    catch (error) { loginFailure = { error }; throw error; }
    return session.token;
  }
  async function request(company: string, code: string, bearer: string, timeoutMs: number) {
    const url = new URL("/material/MalzemeAra", base);
    url.search = new URLSearchParams({ FirmaAdi: company, MalzemeNo: code }).toString();
    return supplierFetch("basbug", url, { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  }
  return async (company, code, timeoutMs) => {
    // Every step gets what is left of the caller's budget, so the budget is an upper bound.
    const deadline = Date.now() + capped(timeoutMs);
    const left = () => capped(deadline - Date.now());
    const bearer = await token(left());
    const response = await request(company, code, bearer, left());
    if (response.status !== 401) return response;
    // The token expired or was revoked early: log in again once.
    await discard(response);
    return request(company, code, await token(left(), bearer), left());
  };
}

type Observed = { id: string; gone: boolean; nf?: number; mif?: number; k?: number; depots?: Record<string, number> };

/**
 * What a live MalzemeAra answer means for a line whose write failed, by the same rules the write and the store use:
 * the live depots replace their saved stock, depots it does not return keep theirs, and the line is available when any
 * depot has stock (db/commerce.sql: stok>0 or sFarkliDepo>0; sYol does not count) and the live cost is positive.
 * Otherwise a different cost is "recosted": that is not a price verdict, since a fixed or campaign price or rounding may
 * keep the sale price as it was. The order decides by the sale price (#861, livePriceChanges).
 */
export function basbugLiveVerdict(saved: { nf: number | null; depolar: Record<string, { stok?: number }> },
  live: { nf: number; depots: Record<string, number> }): "sold_out" | "recosted" | "same" {
  const stock = { ...Object.fromEntries(Object.entries(saved.depolar).map(([depot, value]) => [depot, Number(value?.stok ?? 0)])), ...live.depots };
  // A cost of 0 or less cannot be sold either (db/commerce.sql prices only a positive cost).
  if (!(live.nf > 0) || !Object.values(stock).some(value => value > 0)) return "sold_out";
  return saved.nf !== live.nf ? "recosted" : "same";
}

/**
 * Checks the cart's Başbuğ rows live and writes price and depot stock (see the module comment). Lines it could not
 * confirm come back in `failed` and are sold on saved data; codes the supplier no longer knows come back in `gone`.
 * When the rows stay locked by a running import the answers are not lost (#788): a line no depot has comes back in
 * `soldOut` (the order refuses it), a line with a new cost in `recosted` with its live `nf` in the row's currency (the
 * order refuses it only if its sale price would change, #861), and only an unchanged line is marked "busy".
 * The whole check shares CHECKOUT_REFRESH_BUDGET_MS unless `budgetMs` says otherwise.
 */
export async function refreshBasbugItems(pool: Pool, ids: string[], options: { fetchItem?: BasbugItemFetch; budgetMs?: number } = {}) {
  const failed: Record<string, FallbackReason> = {};
  const result = { refreshed: 0, changed: 0, gone: [] as string[], soldOut: [] as string[], recosted: {} as Record<string, number>, failed };
  if (!ids.length) return result;
  if (basbugPaused()) {
    for (const id of ids) failed[id] = "paused";
    return result;
  }
  const rows = (await pool.query<{ id: string; code: string; company: string; nf: number | null; depolar: Record<string, { stok?: number }> }>(
    `SELECT id::text,code,company,(price_data->>'nf')::float8 AS nf,COALESCE(stock_data->'depolar','{}'::jsonb) AS depolar
     FROM supplier_items WHERE supplier='basbug' AND warehouse='MRK' AND id=ANY($1::uuid[]) ORDER BY id`, [ids])).rows;
  let fetchItem: BasbugItemFetch;
  try { fetchItem = options.fetchItem ?? basbugItemClient(); }
  catch (error) {
    for (const row of rows) failed[row.id] = fallbackReason(error);
    return result;
  }
  const deadline = Date.now() + (options.budgetMs ?? CHECKOUT_REFRESH_BUDGET_MS);
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
        const response = await fetchItem(row.company, row.code, deadline - Date.now());
        // 604's body is plain text ("Malzeme bulunamadı!"), not JSON.
        if (response.status !== 200) await discard(response);
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
  const observedIds = observed.map(item => item.id);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    // A running list import may hold these rows: wait briefly (CHECKOUT_LOCK_TIMEOUT), in id order (no deadlock with
    // another checkout), then merge onto what it committed. Rows locked longer are sold on their saved data, marked "busy".
    await client.query(CHECKOUT_LOCK_TIMEOUT);
    await client.query("SELECT id FROM supplier_items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [observedIds]);
    // Merged onto the current row: sYol and the depots MalzemeAra does not return keep their list values; stok is MRK
    // and sFarkliDepo the sum over every other depot after the merge. A code the supplier no longer knows is out of
    // stock in every depot until a list import decides its presence; that is not a sighting, so last_seen_at stays.
    // product_data is not written, so the enrichment and search triggers (UPDATE OF code,product_data) stay quiet.
    const changed = await client.query(`WITH incoming AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,gone boolean,nf numeric,mif numeric,k numeric,depots jsonb)),
      existing AS (
        SELECT o.id,o.code,o.price_data,n.gone,n.nf,n.mif,n.k,n.depots,
          COALESCE(o.stock_data,'{"sDepo":"MRK","sYol":0,"sFarkliDepo":0}'::jsonb) AS stock,
          COALESCE(o.stock_data->'depolar','{}'::jsonb) AS saved
        FROM supplier_items o JOIN incoming n ON n.id=o.id),
      observed AS (
        SELECT id,gone,stock,CASE WHEN gone THEN price_data
            ELSE COALESCE(price_data,'{}'::jsonb)||jsonb_build_object('no',code,'nf',nf,'mif',mif,'k',k) END AS price_data,
          CASE WHEN gone
            THEN (SELECT COALESCE(jsonb_object_agg(d.key,d.value||'{"stok":0}'::jsonb),'{}'::jsonb) FROM jsonb_each(saved) d)
              ||jsonb_build_object('MRK',COALESCE(saved->'MRK','{"sYol":0}'::jsonb)||'{"stok":0}'::jsonb)
            ELSE saved||(SELECT jsonb_object_agg(d.key,COALESCE(saved->d.key,'{"sYol":0}'::jsonb)||jsonb_build_object('stok',d.value)) FROM jsonb_each(depots) d)
          END AS depolar
        FROM existing),
      merged AS (
        SELECT id,gone,price_data,stock||jsonb_build_object('stok',COALESCE((depolar#>>'{MRK,stok}')::numeric,0),
          'sFarkliDepo',(SELECT COALESCE(sum(GREATEST((d.value->>'stok')::numeric,0)),0) FROM jsonb_each(depolar) d WHERE d.key<>'MRK'),
          'depolar',depolar) AS stock_data
        FROM observed),
      -- CTEs share the statement's snapshot, so this still reads the values before the update.
      before AS (
        SELECT o.id,jsonb_build_object('product',o.product_data,'price',o.price_data,'stock',o.stock_data) AS data
        FROM supplier_items o JOIN merged n ON n.id=o.id
        WHERE ROW(o.price_data,o.stock_data) IS DISTINCT FROM ROW(n.price_data,n.stock_data)),
      updated AS (
        UPDATE supplier_items o SET price_data=n.price_data,stock_data=n.stock_data,
          last_seen_at=CASE WHEN n.gone THEN o.last_seen_at ELSE now() END,changed_at=now()
        FROM merged n JOIN before b ON b.id=n.id WHERE o.id=n.id
        RETURNING o.id,o.product_data,o.price_data,o.stock_data,o.conflicting,o.source_variants,o.presence)
      INSERT INTO supplier_item_changes(item_id,import_id,changed_at,kind,before_data,after_data)
      SELECT u.id,NULL,now(),'changed',b.data,jsonb_build_object('product',u.product_data,'price',u.price_data,'stock',u.stock_data,
        'conflicting',u.conflicting,'variants',u.source_variants,'presence',u.presence,'source','checkout')
      FROM updated u JOIN before b ON b.id=u.id`, [JSON.stringify(observed)]);
    await client.query("UPDATE supplier_items SET last_seen_at=now() WHERE id=ANY($1::uuid[])", [observed.filter(item => !item.gone).map(item => item.id)]);
    await client.query("COMMIT");
    result.refreshed = observed.length;
    result.changed = changed.rowCount ?? 0;
    result.gone = observed.filter(item => item.gone).map(item => item.id);
    return result;
  } catch (error) {
    // Nothing was written, but the answers still count: codes it no longer knows (604) are reported gone, lines no depot
    // has sold out (the order refuses them) and lines with a new cost come back with it, for the order to judge by the
    // sale price. Only unchanged lines are sold on saved data and marked.
    await client?.query("ROLLBACK").catch(() => undefined);
    console.error("Başbuğ checkout check could not be saved", { reason: error instanceof Error ? error.message : error });
    result.gone = observed.filter(item => item.gone).map(item => item.id);
    const saved = new Map(rows.map(row => [row.id, row]));
    for (const item of observed) {
      if (item.gone) continue;
      const row = saved.get(item.id);
      const verdict = row && item.nf !== undefined && item.depots ? basbugLiveVerdict(row, { nf: item.nf, depots: item.depots }) : "same";
      if (verdict === "sold_out") result.soldOut.push(item.id);
      else if (verdict === "recosted" && item.nf !== undefined) result.recosted[item.id] = item.nf;
      else failed[item.id] = "busy";
    }
    return result;
  } finally { client?.release(); }
}
