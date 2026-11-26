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
 * Pages 1-20 keep their own 480 ids (catalog.ts) and never build an order, so a cold page 1 never waits for a whole one
 * (/katalog ~6.6 s). Their cache takes the stored order's first 480 ids instead of pricing the listing again when a memory
 * miss, refresh or epoch reload finds that row newer than their stored page ids (priceOrderHeadStore, #1389): such a load
 * does not price a listing a deep page ordered again, and its pages 20 and 21 then come from one order. Pages 1-20 do not
 * slice the order per request: the array is read whole to slice it (/katalog, 807k ids: ~1 ms in SQL, and a warm page 1
 * 2-4 ms slower over HTTP when measured). Their stored sources are shared storage: LISTING_CACHE_PERSIST=0 (or a missing
 * storefront_listing_cache) keeps them off the order too, and LISTING_PRICE_ORDER=0 off the order alone.
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
let disabledUntil = 0, builds = 0;
/** Keys (hashed) whose last build failed, with when they may build again; expired entries go on the next failure. */
const failedBuilds = new Map<string, number>();
const lastLogged = new Map<string, number>();

/** The stored order as the process cache keeps it: its id count, 0 when nothing was stored. */
export type PriceOrder = { total: number };

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
 * holds 1 to `maxParam` ids; a row of a newer epoch is kept. Returns the stored total, no row when nothing was stored.
 */
export function priceOrderBuildSql(pricedSql: string, order: string, keyParam: string, epochParam: string, maxParam: string) {
  return `${orderedSql(pricedSql, order)}
 INSERT INTO storefront_listing_price_orders(key_hash,epoch,total,ids)
 SELECT ${keyParam}::text,${epochParam}::bigint,cardinality(ids),ids FROM ordered WHERE cardinality(ids) BETWEEN 1 AND ${maxParam}::int
 ON CONFLICT (key_hash) DO UPDATE SET epoch=excluded.epoch,total=excluded.total,ids=excluded.ids,computed_at=now()
  WHERE excluded.epoch>=storefront_listing_price_orders.epoch
 RETURNING total`;
}

/**
 * Orders the listing (`pricedSql` with `values`) by `order` and stores it under `key` and `epoch` (the value its key
 * follows, read before the listing's filter was built: the process cache's load value, catalog.ts), with boundedQuery's
 * 30 s limit and priceOrderWorkMem. `{ total: 0 }` when
 * nothing was stored: no rows, more than priceOrderMaxIds, a newer row kept, the table missing, or a failed build. Never
 * throws: the page then reads live. A failed build (a statement timeout, 57014, or any other error) is remembered for
 * the key: its builds return `{ total: 0 }` without a query until failedBuildBackoffMs after the failed one started, so
 * a listing whose build cannot finish reads live instead of starting another 30 s build per request or epoch reload.
 */
export async function buildPriceOrder(key: string, epoch: number, pricedSql: string, values: unknown[], order: string): Promise<PriceOrder> {
  if (!priceOrderEnabled()) return { total: 0 };
  const hash = keyHash(key), started = Date.now();
  if ((failedBuilds.get(hash) ?? 0) > started) return { total: 0 };
  const at = values.length;
  try {
    const { rows } = await boundedQuery<{ total: number }>(`catalog.priceOrder ${key}`,
      priceOrderBuildSql(pricedSql, order, `$${at + 1}`, `$${at + 2}`, `$${at + 3}`), [...values, hash, epoch, priceOrderMaxIds()],
      30_000, { workMem: priceOrderWorkMem, write: true });
    // Keys nobody reads any more (a removed category, an old version) are dropped now and then.
    if (++builds % pruneEvery === 0) db.query("DELETE FROM storefront_listing_price_orders WHERE computed_at<now()-interval '2 days'").catch(error => failed("prune", error));
    return { total: rows[0]?.total ?? 0 };
  } catch (error) {
    if (missingTable(error)) {
      failed("build", error);
      return { total: 0 };
    }
    // Expired failures go first, so the map holds only listings whose build failed within the back-off.
    for (const [failedKey, until] of failedBuilds) if (until <= started) failedBuilds.delete(failedKey);
    failedBuilds.set(hash, started + failedBuildBackoffMs);
    logError("build", `build failed (${errorCode(error) ?? "no code"}); the listing reads live for ${failedBuildBackoffMs / 60_000} minutes`, error);
    return { total: 0 };
  }
}

/**
 * `limit` ids of the stored order from `offset` (0-based), sliced in SQL; null without a stored row, [] past its end.
 * A named statement: every deep page reads one.
 */
export async function priceOrderSlice(key: string, offset: number, limit: number): Promise<string[] | null> {
  if (!priceOrderEnabled()) return null;
  try {
    const { rows } = await preparedQuery<{ ids: string[] }>(db, "SELECT ids[$2::int:$3::int]::text[] AS ids FROM storefront_listing_price_orders WHERE key_hash=$1",
      [keyHash(key), offset + 1, offset + limit]);
    return rows[0]?.ids ?? null;
  } catch (error) {
    failed("slice", error);
    return null;
  }
}

type Stored<T> = Awaited<ReturnType<StaleCacheStore<T>["read"]>>;
/**
 * The second level of the price-sorted first pages' cache (#1389, cachedPricedHeads in catalog.ts): `pageIds` (their
 * storefront_listing_cache rows) and the stored order's first `size()` ids, read side by side; the row of the higher
 * epoch wins, then the younger one. staleCache then adopts or refuses it under its own rules, so a refresh or epoch
 * reload takes a current order a deep page built instead of pricing the listing again, and a memory miss one up to 24
 * hours old. The order's first ids are its first pages: the same rows priced and sorted the same way, the id breaking
 * ties. Writes go to `pageIds` only (a 480-id pass loaded them); an order is written by its build alone. An error on
 * either read counts as no row there.
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
