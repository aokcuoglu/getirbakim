import "server-only";
import { createHash } from "node:crypto";
import { boundedQuery, db, preparedQuery } from "@/lib/db";
import type { StaleCacheStore } from "@/lib/stale-cache";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { listingCacheEnabled } from "./listing-cache-store";

/**
 * The whole price order of a plain listing, for its pages past the cached first 20 (#1369, db/storefront-catalog.sql
 * storefront_listing_price_orders). A deep price-sorted page priced and sorted every row of the listing per request
 * (ORIJINAL, 155k rows: ~1.8 s locally, 5-6 s live); building the whole order costs about the same once, and a page then
 * slices it. One statement prices, sorts and stores the order (buildPriceOrder), and a page reads its slice
 * (priceOrderSlice): the ids never pass through Node (#1262). The process cache in catalog.ts (cachedPriceOrders) keeps
 * only the stored order's size, under the persisted listings' rules: rebuilt after 10 minutes in the background, a row up
 * to 24 hours old adopted on a memory miss, a row of an older epoch rebuilt, the earlier row (up to 48 hours old, not
 * empty) served after the bounded wait (#771). A row's epoch is the value its key follows (listing-epoch.ts, #1368): a
 * make's listing the fits value, the others the listing epoch.
 * The key hash covers priceOrderVersion (bump it when the stored order's meaning changes) and the storefront's supplier
 * companies, as listingCacheStore's. #1368 kept it at 1: the fits value starts at the epoch the rows already carry, so a
 * stored row keeps its meaning. LISTING_PRICE_ORDER=0 turns the stored orders off (deep pages read live again);
 * LISTING_PRICE_ORDER_MAX_IDS (default 1,000,000) is the largest listing stored. A missing table (setup not run yet)
 * turns them off for five minutes. Errors never reach the page: a failed read or slice reads the page live, and so does a
 * failed build (its 30 s limit included), after which the listing reads live for ten minutes instead of starting another
 * build per request. Errors are logged, each kind at most once a minute.
 * Pages 1-20 keep their own 480 ids (catalog.ts). Their cache takes the stored order's first 480 ids instead of pricing the
 * listing again when a memory miss, refresh or epoch reload finds that row newer than their stored page ids
 * (priceOrderHeadStore, #1389): such a load does not price a listing a deep page ordered again, and its pages 20 and 21
 * then come from one order. Pages 1-20 do not slice the order per request: the array is read whole to slice it (/katalog,
 * 807k ids: ~1 ms in SQL, and a warm page 1 2-4 ms slower over HTTP when measured). Their stored sources are shared
 * storage: LISTING_CACHE_PERSIST=0 (or a missing storefront_listing_cache) keeps them off the order too, and
 * LISTING_PRICE_ORDER=0 off the order alone.
 * A listing whose deep pages are in use is priced once per refresh (#1405): a slice moves the row's last_sliced_at (at
 * most once a minute, touchSliced), and a load of the first pages that finds it within priceOrderDeepUseMs (two cache TTLs,
 * priceOrderInUse) rebuilds the whole order and takes its first ids from the same statement (buildPriceOrder's `head`),
 * instead of its own 480-id pass beside the deep pages' rebuild. Both caches build through buildPriceOrder with the same
 * head size: one build per key, epoch and head size runs at a time in a process, and one that finds a row of its epoch
 * (or a newer one) at most `freshMs` old returns that row instead. Without recent deep use (a cold page 1, a listing
 * only its first pages are read from) the first pages never build an order: a cold page 1 never waits for a whole one
 * (/katalog ~6.6 s), and a hot page 1 alone does not rewrite a listing's whole order every 10 minutes. Until setup has
 * added last_sliced_at (a missing column, 42703) the first pages price their own ids and slices leave it alone, for five
 * minutes at a time.
 */
export const priceOrderVersion = 1;
/** The build's work_mem: the whole order is sorted in memory (ORIJINAL ~12 MB; /katalog's 900k rows need more). */
export const priceOrderWorkMem = "64MB";
const defaultMaxIds = 1_000_000;
/** The stored total and the build's bound are integer columns and parameters. */
const maxInt = 2_147_483_647;
const pruneEvery = 20;
const missingTableBackoffMs = 5 * 60 * 1000;
/** How long after a failed build starts its listing reads live before it builds again. */
export const failedBuildBackoffMs = 10 * 60 * 1000;
/** How recently a deep page must have sliced a listing's order for its first pages to rebuild it (#1405): two cache TTLs. */
export const priceOrderDeepUseMs = 20 * 60 * 1000;
/** A row's last_sliced_at moves at most this often: per key in a process, and in SQL across processes. */
export const sliceTouchMs = 60_000;
const missingColumnBackoffMs = 5 * 60 * 1000;
/** The touch throttle's size at which its expired keys go. */
const touchedPruneAt = 1000;
let disabledUntil = 0, gateOffUntil = 0, builds = 0;
/** Keys (hashed) whose last build failed, with when they may build again; expired entries go on the next failure. */
const failedBuilds = new Map<string, number>();
/** Builds running in this process, by key hash, epoch and head size: a second caller shares the first one's. */
const inFlight = new Map<string, Promise<BuiltPriceOrder>>();
/** Keys (hashed) whose last_sliced_at this process last moved, with when; touches not yet settled. */
const touched = new Map<string, number>();
const touches = new Set<Promise<void>>();
const lastLogged = new Map<string, number>();

/** The stored order as the process cache keeps it: its id count, 0 when nothing was stored. */
export type PriceOrder = { total: number };
/** What a build returns: the stored order's size and its first `head` ids; `{ total: 0, head: [] }` when nothing was stored. */
export type BuiltPriceOrder = PriceOrder & { head: string[] };
const nothingStored = (): BuiltPriceOrder => ({ total: 0, head: [] });

/**
 * Logs at most once a minute per `kind`: a database outage would otherwise log on every request, and a missing table is
 * still reported right after a failed build.
 */
function logError(kind: string, message: string, error: unknown) {
  const now = Date.now();
  if (now - (lastLogged.get(kind) ?? -Infinity) < 60_000) return;
  lastLogged.set(kind, now);
  console.error(`Listing price order: ${message}`, error instanceof Error ? error.message : error);
}
const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;
const missingTable = (error: unknown) => errorCode(error) === "42P01";
function failed(action: string, error: unknown) {
  if (missingTable(error)) {
    disabledUntil = Date.now() + missingTableBackoffMs;
    logError("missing", `${action} failed: storefront_listing_price_orders is missing; deep price pages read live for 5 minutes`, error);
  } else logError(action, `${action} failed; reading live instead`, error);
}
/**
 * Whether `error` is a missing column (42703: setup has not added last_sliced_at yet). If so, the first pages' gate and
 * the slices' touch stay off for five minutes, logged once per period; the stored orders themselves keep working.
 */
function missingColumn(error: unknown) {
  if (errorCode(error) !== "42703") return false;
  gateOffUntil = Date.now() + missingColumnBackoffMs;
  logError("column", "last_sliced_at is missing (setup not run yet); the first pages price their own ids for 5 minutes", error);
  return true;
}

/** Whether deep price pages read stored orders: LISTING_PRICE_ORDER is not 0 and the table was not found missing lately. Read per request. */
export function priceOrderEnabled() {
  return process.env.LISTING_PRICE_ORDER?.trim() !== "0" && Date.now() >= disabledUntil;
}
/** The largest listing whose order is stored: LISTING_PRICE_ORDER_MAX_IDS (blank or invalid: 1,000,000; at most 2^31-1). */
export function priceOrderMaxIds() {
  const setting = process.env.LISTING_PRICE_ORDER_MAX_IDS?.trim();
  const value = setting ? Number(setting) : defaultMaxIds;
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maxInt) : defaultMaxIds;
}
const keyHash = (key: string) => createHash("sha256").update(JSON.stringify([priceOrderVersion, storefrontCompanies(), key])).digest("hex");

/**
 * The stored order's size, age and epoch, for the process cache (staleCache's second level): the row's own columns, never
 * its ids (no detoast). Nothing to write: the build statement stored the row.
 */
export const priceOrderStore: StaleCacheStore<PriceOrder> = {
  async read(key) {
    if (!priceOrderEnabled()) return null;
    try {
      const { rows } = await db.query<{ total: number; epoch: string; age_ms: string }>(
        `SELECT total,epoch::text AS epoch,(extract(epoch FROM now()-computed_at)*1000)::bigint::text AS age_ms
         FROM storefront_listing_price_orders WHERE key_hash=$1`, [keyHash(key)]);
      return rows[0] ? { value: { total: rows[0].total }, epoch: Number(rows[0].epoch), ageMs: Number(rows[0].age_ms) } : null;
    } catch (error) {
      failed("read", error);
      return null;
    }
  },
  async write() {},
};

/**
 * The build's two steps: `priced`, the listing's rows (`pricedSql`: their id, unavailable and price_kurus), read once;
 * `ordered`, their ids sorted by `order` (the live page's ORDER BY) into one uuid[].
 */
const orderedSql = (pricedSql: string, order: string) => `WITH priced AS MATERIALIZED (${pricedSql}),
 ordered AS (SELECT ARRAY(SELECT id FROM priced ORDER BY ${order}) AS ids)`;
/** The order the build stores, as a plain select (scripts/listing-summary-timings.ts compares it with the live page). */
export const priceOrderSelectSql = (pricedSql: string, order: string) => `${orderedSql(pricedSql, order)}
 SELECT ids FROM ordered`;
/**
 * One statement that orders the listing and stores it under the key hash (`keyParam`) and epoch (`epochParam`), when it
 * holds 1 to `maxParam` ids; a row of a newer epoch is kept. Returns the stored total and its first `headParam` ids, no
 * row when nothing was stored. It names neither last_sliced_at (a rebuild keeps it) nor any column setup may still lack.
 */
export function priceOrderBuildSql(pricedSql: string, order: string, keyParam: string, epochParam: string, maxParam: string, headParam: string) {
  return `${orderedSql(pricedSql, order)}
 INSERT INTO storefront_listing_price_orders(key_hash,epoch,total,ids)
 SELECT ${keyParam}::text,${epochParam}::bigint,cardinality(ids),ids FROM ordered WHERE cardinality(ids) BETWEEN 1 AND ${maxParam}::int
 ON CONFLICT (key_hash) DO UPDATE SET epoch=excluded.epoch,total=excluded.total,ids=excluded.ids,computed_at=now()
  WHERE excluded.epoch>=storefront_listing_price_orders.epoch
 RETURNING total,ids[1:${headParam}::int]::text[] AS head`;
}

/**
 * Orders the listing (`pricedSql` with `values`) by `order` and stores it under `key` and `epoch` (the value its key
 * follows, read before the listing's filter was built: the process cache's load value, catalog.ts), with boundedQuery's
 * 30 s limit and priceOrderWorkMem. Returns the stored total and its first `head` ids (none by default), `{ total: 0,
 * head: [] }` when nothing was stored: no rows, more than priceOrderMaxIds, a newer row kept, the table missing, or a
 * failed build. Never throws: the page then reads live. A failed build (a statement timeout, 57014, or any other error)
 * is remembered for the key: its builds return nothing without a query until failedBuildBackoffMs after the failed one
 * started, so a listing whose build cannot finish reads live instead of starting another 30 s build per request or epoch
 * reload.
 * One build per key, epoch and head size runs at a time in this process: a call while one runs gets its result (#1405,
 * the deep pages' and the first pages' caches refreshing together). With `freshMs`, a row of this epoch or a newer one
 * at most `freshMs` old is returned instead of building (another cache or process built it since its caller read the
 * row); a failed check is logged and the build goes on. Two processes can still build one key at the same moment.
 */
export function buildPriceOrder(key: string, epoch: number, pricedSql: string, values: unknown[], order: string,
  { head = 0, freshMs }: { head?: number; freshMs?: number } = {}): Promise<BuiltPriceOrder> {
  if (!priceOrderEnabled()) return Promise.resolve(nothingStored());
  const hash = keyHash(key), started = Date.now();
  if ((failedBuilds.get(hash) ?? 0) > started) return Promise.resolve(nothingStored());
  const flight = `${hash}|${epoch}|${head}`, running = inFlight.get(flight);
  if (running) return running;
  const build = storeOrder(key, hash, epoch, started, pricedSql, values, order, head, freshMs)
    .finally(() => { if (inFlight.get(flight) === build) inFlight.delete(flight); });
  inFlight.set(flight, build);
  return build;
}

/** buildPriceOrder's work, run once per in-flight key: the fresh-row check, then the statement. */
async function storeOrder(key: string, hash: string, epoch: number, started: number, pricedSql: string, values: unknown[], order: string,
  head: number, freshMs: number | undefined): Promise<BuiltPriceOrder> {
  if (freshMs !== undefined) {
    try {
      const { rows } = await db.query<BuiltPriceOrder>(`SELECT total,ids[1:$2::int]::text[] AS head FROM storefront_listing_price_orders
        WHERE key_hash=$1 AND epoch>=$3::bigint AND computed_at>now()-$4::bigint*interval '1 millisecond'`, [hash, head, epoch, Math.round(freshMs)]);
      if (rows[0]) return rows[0];
    } catch (error) {
      // A missing table turns the stored orders off (failed); any other failure only skips the check.
      if (missingTable(error)) failed("recheck", error);
      else logError("recheck", "fresh-row check failed; building the order anyway", error);
    }
  }
  const at = values.length;
  try {
    const { rows } = await boundedQuery<BuiltPriceOrder>(`catalog.priceOrder ${key}`,
      priceOrderBuildSql(pricedSql, order, `$${at + 1}`, `$${at + 2}`, `$${at + 3}`, `$${at + 4}`), [...values, hash, epoch, priceOrderMaxIds(), head],
      30_000, { workMem: priceOrderWorkMem, write: true });
    // Keys nobody reads any more (a removed category, an old version) are dropped now and then.
    if (++builds % pruneEvery === 0) db.query("DELETE FROM storefront_listing_price_orders WHERE computed_at<now()-interval '2 days'").catch(error => failed("prune", error));
    return rows[0] ?? nothingStored();
  } catch (error) {
    if (missingTable(error)) {
      failed("build", error);
      return nothingStored();
    }
    // Expired failures go first, so the map holds only listings whose build failed within the back-off.
    for (const [failedKey, until] of failedBuilds) if (until <= started) failedBuilds.delete(failedKey);
    failedBuilds.set(hash, started + failedBuildBackoffMs);
    logError("build", `build failed (${errorCode(error) ?? "no code"}); the listing reads live for ${failedBuildBackoffMs / 60_000} minutes`, error);
    return nothingStored();
  }
}

/**
 * `limit` ids of the stored order from `offset` (0-based), sliced in SQL; null without a stored row, [] past its end.
 * A named statement: every deep page reads one. A slice of a stored row marks the listing's deep pages as in use
 * (touchSliced, not awaited).
 */
export async function priceOrderSlice(key: string, offset: number, limit: number): Promise<string[] | null> {
  if (!priceOrderEnabled()) return null;
  const hash = keyHash(key);
  try {
    const { rows } = await preparedQuery<{ ids: string[] }>(db, "SELECT ids[$2::int:$3::int]::text[] AS ids FROM storefront_listing_price_orders WHERE key_hash=$1",
      [hash, offset + 1, offset + limit]);
    if (!rows[0]) return null;
    touchSliced(hash);
    return rows[0].ids;
  } catch (error) {
    failed("slice", error);
    return null;
  }
}

/** Logs a failed gate read or touch: a missing table turns the stored orders off (failed), anything else only logs. */
function gateFailed(action: string, error: unknown) {
  if (missingTable(error)) failed(action, error);
  else logError(action, `${action} failed; the first pages price their own ids`, error);
}

/**
 * Moves the row's last_sliced_at to now, not awaited: at most once per sliceTouchMs a key in this process, and in SQL only
 * when the stored value is older than that (another process may have moved it). An UPDATE of that column alone, which
 * no index covers: the array is not rewritten, and the update stays heap-only where the page has room. A missing column
 * stops the touches for five minutes (missingColumn).
 */
function touchSliced(hash: string) {
  const now = Date.now();
  if (now < gateOffUntil || now - (touched.get(hash) ?? -Infinity) < sliceTouchMs) return;
  if (touched.size >= touchedPruneAt) for (const [key, at] of touched) if (now - at >= sliceTouchMs) touched.delete(key);
  touched.set(hash, now);
  const touch: Promise<void> = db.query(`UPDATE storefront_listing_price_orders SET last_sliced_at=now()
    WHERE key_hash=$1 AND (last_sliced_at IS NULL OR last_sliced_at<now()-$2::bigint*interval '1 millisecond')`, [hash, sliceTouchMs])
    .then(() => {}, error => { if (!missingColumn(error)) gateFailed("touch", error); })
    .finally(() => { touches.delete(touch); });
  touches.add(touch);
}

/** Resolves once every touch started so far has settled (a test sets last_sliced_at itself after it). */
export async function sliceTouchesSettled() {
  await Promise.all([...touches]);
}

/**
 * Whether a deep page sliced `key`'s stored order within priceOrderDeepUseMs (#1405): a load of the listing's first
 * pages then rebuilds the order instead of pricing their own 480 ids (catalog.ts). One primary-key read, sent by such a
 * load only (a miss, a refresh once per cache TTL, an epoch reload), never by a warm page. False without a query while
 * the stored orders or the page ids' store are off (priceOrderEnabled, listingCacheEnabled) or within five minutes of
 * finding last_sliced_at missing; false on any error, logged.
 */
export async function priceOrderInUse(key: string): Promise<boolean> {
  if (!priceOrderEnabled() || !listingCacheEnabled() || Date.now() < gateOffUntil) return false;
  try {
    const { rows } = await db.query(`SELECT 1 FROM storefront_listing_price_orders
      WHERE key_hash=$1 AND last_sliced_at>now()-$2::bigint*interval '1 millisecond'`, [keyHash(key), priceOrderDeepUseMs]);
    return rows.length > 0;
  } catch (error) {
    if (!missingColumn(error)) gateFailed("gate", error);
    return false;
  }
}

type Stored<T> = Awaited<ReturnType<StaleCacheStore<T>["read"]>>;
/**
 * The second level of the price-sorted first pages' cache (#1389, cachedPricedHeads in catalog.ts): `pageIds` (their
 * storefront_listing_cache rows) and the stored order's first `size()` ids, read side by side; the row of the higher
 * epoch wins, then the younger one. staleCache then adopts or refuses it under its own rules, so a refresh or epoch
 * reload takes a current order a deep page built instead of pricing the listing again, and a memory miss one up to 24
 * hours old. The order's first ids are its first pages: the same rows priced and sorted the same way, the id breaking
 * ties. Writes go to `pageIds` only (a 480-id pass loaded them, or a build's first ids, #1405); an order is written by
 * its build alone. An error on either read counts as no row there.
 * The order is read only while the page ids' store is on (listingCacheEnabled: LISTING_CACHE_PERSIST, the missing-table
 * back-off) and the stored orders are (priceOrderEnabled), and only a row at most `maxAgeMs` old (the cache's longest
 * window, its maxFallbackMs): reading the first ids unpacks the whole array (/katalog ~13 MB), which a row no caller may
 * take is not worth.
 */
export function priceOrderHeadStore(pageIds: StaleCacheStore<string[]>, size: () => number, maxAgeMs: number): StaleCacheStore<string[]> {
  const head = async (key: string): Promise<Stored<string[]>> => {
    if (!priceOrderEnabled() || !listingCacheEnabled()) return null;
    try {
      const { rows } = await preparedQuery<{ ids: string[]; epoch: string; age_ms: string }>(db,
        `SELECT ids[1:$2::int]::text[] AS ids,epoch::text AS epoch,(extract(epoch FROM now()-computed_at)*1000)::bigint::text AS age_ms
         FROM storefront_listing_price_orders WHERE key_hash=$1 AND computed_at>now()-$3::bigint*interval '1 millisecond'`, [keyHash(key), size(), maxAgeMs]);
      return rows[0] ? { value: rows[0].ids, epoch: Number(rows[0].epoch), ageMs: Number(rows[0].age_ms) } : null;
    } catch (error) {
      failed("head", error);
      return null;
    }
  };
  return {
    async read(key) {
      const [order, stored] = await Promise.all([head(key), pageIds.read(key).catch(() => null)]);
      if (!order || !stored) return order ?? stored;
      if (order.epoch !== stored.epoch) return order.epoch > stored.epoch ? order : stored;
      return order.ageMs <= stored.ageMs ? order : stored;
    },
    write: (key, value, epoch) => pageIds.write(key, value, epoch),
  };
}
