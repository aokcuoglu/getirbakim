import "server-only";
import { createHash } from "node:crypto";
import { boundedQuery, db, preparedQuery } from "@/lib/db";
import type { StaleCacheStore } from "@/lib/stale-cache";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";

/**
 * The whole price order of a plain listing, for its pages past the cached first 20 (#1369, db/storefront-catalog.sql
 * storefront_listing_price_orders). A deep price-sorted page priced and sorted every row of the listing per request
 * (ORIJINAL, 155k rows: ~1.7 s locally, 5-6 s live); building the whole order costs about the same once, and a page then
 * slices it. One statement prices, sorts and stores the order (buildPriceOrder), and a page reads its slice
 * (priceOrderSlice): the ids never pass through Node (#1262). The process cache in catalog.ts (cachedPriceOrders) keeps
 * only the stored order's size, under the persisted listings' rules: rebuilt after 10 minutes in the background, a row up
 * to 24 hours old adopted on a memory miss, a row of an older epoch rebuilt, the earlier row (up to 48 hours old, not
 * empty) served after the bounded wait (#771).
 * The key hash covers priceOrderVersion (bump it when the stored order's meaning changes) and the storefront's supplier
 * companies, as listingCacheStore's. LISTING_PRICE_ORDER=0 turns the stored orders off (deep pages read live again);
 * LISTING_PRICE_ORDER_MAX_IDS (default 1,000,000) is the largest listing stored. A missing table (setup not run yet)
 * turns them off for five minutes. Read and slice errors are logged (throttled) and read live; a build error other than
 * the missing table reaches the page, as the live read's would.
 */
export const priceOrderVersion = 1;
/** The build's work_mem: the whole order is sorted in memory (ORIJINAL ~12 MB; /katalog's 900k rows need more). */
export const priceOrderWorkMem = "64MB";
const defaultMaxIds = 1_000_000;
const pruneEvery = 20;
const missingTableBackoffMs = 5 * 60 * 1000;
let disabledUntil = 0, builds = 0, lastErrorLog = 0;

/** The stored order as the process cache keeps it: its id count, 0 when nothing was stored. */
export type PriceOrder = { total: number };

function logError(message: string, error: unknown) {
  // A database outage would otherwise log on every request.
  if (Date.now() - lastErrorLog < 60_000) return;
  lastErrorLog = Date.now();
  console.error(`Listing price order: ${message}`, error instanceof Error ? error.message : error);
}
const missingTable = (error: unknown) => (error as { code?: string } | null)?.code === "42P01";
function failed(action: string, error: unknown) {
  if (missingTable(error)) {
    disabledUntil = Date.now() + missingTableBackoffMs;
    logError(`${action} failed: storefront_listing_price_orders is missing; deep price pages read live for 5 minutes`, error);
  } else logError(`${action} failed; reading live instead`, error);
}

/** Whether deep price pages read stored orders: LISTING_PRICE_ORDER is not 0 and the table was not found missing lately. Read per request. */
export function priceOrderEnabled() {
  return process.env.LISTING_PRICE_ORDER?.trim() !== "0" && Date.now() >= disabledUntil;
}
/** The largest listing whose order is stored: LISTING_PRICE_ORDER_MAX_IDS (blank or invalid: 1,000,000). */
export function priceOrderMaxIds() {
  const setting = process.env.LISTING_PRICE_ORDER_MAX_IDS?.trim();
  const value = setting ? Number(setting) : defaultMaxIds;
  return Number.isSafeInteger(value) && value > 0 ? value : defaultMaxIds;
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
 * Orders the listing (`pricedSql` with `values`) by `order` and stores it under `key` and `epoch` (the listing epoch read
 * before the build), with boundedQuery's 30 s limit and priceOrderWorkMem. `{ total: 0 }` when nothing was stored: no
 * rows, more than priceOrderMaxIds, a newer row kept, or the table missing.
 */
export async function buildPriceOrder(key: string, epoch: number, pricedSql: string, values: unknown[], order: string): Promise<PriceOrder> {
  if (!priceOrderEnabled()) return { total: 0 };
  const at = values.length;
  try {
    const { rows } = await boundedQuery<{ total: number }>(`catalog.priceOrder ${key}`,
      priceOrderBuildSql(pricedSql, order, `$${at + 1}`, `$${at + 2}`, `$${at + 3}`), [...values, keyHash(key), epoch, priceOrderMaxIds()],
      30_000, { workMem: priceOrderWorkMem, write: true });
    // Keys nobody reads any more (a removed category, an old version) are dropped now and then.
    if (++builds % pruneEvery === 0) db.query("DELETE FROM storefront_listing_price_orders WHERE computed_at<now()-interval '2 days'").catch(error => failed("prune", error));
    return { total: rows[0]?.total ?? 0 };
  } catch (error) {
    if (!missingTable(error)) throw error;
    failed("build", error);
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
