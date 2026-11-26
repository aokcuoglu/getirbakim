import "server-only";
import type { VehicleSearchScope } from "./catalog";

/**
 * The order of a search, kept in this process (#1425 price sorts, #1440 the ranked ones). A search ran its hit read, a live
 * count and the page on every page: page 2, page 3 and the switch back to page 1 paid them again. One lean statement that
 * returns only the whole order (id and the columns its ORDER BY reads, priceOrderTextSql) costs less than the live count and
 * page together, its length is the live count and its slice the live page's ids, so the order is loaded once per search,
 * filters and sort and every page slices it: the warm page reads only its cards (catalog.ts, searchOrder). Sorts covered:
 * price-asc and price-desc (#1425), relevance with a filter and newest (#1440; a plain relevance search without filters
 * has its own cache, plainSearch). Measured locally, lean order against today's count + ranked page, the id count equal
 * to the live count each time:
 *   q=filtre&availability=in_stock   1.01-1.1 s  vs 1.95 s
 *   q=fren&brand=BOSCH               0.15 s      vs 0.59 s
 *   q=bosch&category=yedek-parca     0.6-0.69 s  vs 2.21 s
 *   q=fren&sort=newest               0.42 s      vs 1.16 s
 *   fren price order                 0.71-0.83 s vs ~1.0 s
 * The value is the order, not the hit set: the ids packed 16 bytes each in one Buffer (1,000,000 ids ~16 MB), loaded as one
 * uuid[] text literal so no row object is made per id, plus the search's notes (correctedQuery, vehicle scope, tooShort).
 * Cards are read live by id, so prices, stock and hidden products stay current; only the position and the total can be
 * one reload behind (10 minutes, then stale-while-revalidate; an admin edit and, for a search that reads vehicle fits,
 * the fit sync reload it through the epochs, waiting at most LISTING_EPOCH_WAIT_MS like the other search caches). A price
 * change without an epoch bump keeps its position until the next reload.
 * One cache and one budget: SEARCH_PRICE_ORDER_MAX_IDS (default 1,000,000) bounds the ids of every cached order, price
 * and ranked alike, the least recently used keys going first, and 300 keys. A build that fails (30 s limit included) throws
 * SearchOrderBuildError: the caller reads that request live and holds the key, 10 minutes after a failure and an hour
 * after a statement timeout (as #1390's filtered orders), so a search that cannot be ordered is not tried on every
 * request. A held key bypasses the cache: every request in the hold reads live, also when the key has an earlier entry (a
 * failed reload would otherwise keep serving an order older than an edit), and no loader runs, so nothing is logged per
 * request. The request whose load fails may still get the earlier entry.
 * Switches, read per request: SEARCH_PRICE_ORDER=0 reads every price-sorted search live again (the rollback), apart from
 * LISTING_PRICE_ORDER, which keeps governing the stored listing orders; SEARCH_RANK_ORDER=0 does the same for the
 * relevance and newest searches, leaving the price orders cached.
 * The listing price orders stored in the database (listing-price-order.ts) never serve a search: their key has no query.
 */
const defaultMaxIds = 1_000_000;
const idBytes = 16;

/** A search's order (price, relevance or newest) as the cache keeps it: `total` ids packed in `packed`, and the search's notes. */
export type SearchOrder = {
  packed: Buffer;
  total: number;
  correctedQuery?: string;
  vehicle?: VehicleSearchScope;
  tooShort?: boolean;
};

/** Thrown when the order statement fails: the caller reads that request live and holds the key (catalog.ts). */
export class SearchOrderBuildError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "SearchOrderBuildError";
  }
}

/** Whether relevance and newest searches (the ranked ones) read the cached order: SEARCH_RANK_ORDER is not 0. Read per request. */
export function searchRankOrderEnabled() {
  return process.env.SEARCH_RANK_ORDER?.trim() !== "0";
}
/**
 * Whether the facets of a scoped search (category, make, model, manufacturer, garage vehicle, oil) are cached (#1441):
 * SEARCH_FACETS_CACHE is not 0. Read per request; 0 reads them live again (the rollback).
 */
export function searchFacetsEnabled() {
  return process.env.SEARCH_FACETS_CACHE?.trim() !== "0";
}
/** Whether price-sorted searches read the cached order: SEARCH_PRICE_ORDER is not 0. Read per request. */
export function searchPriceOrderEnabled() {
  return process.env.SEARCH_PRICE_ORDER?.trim() !== "0";
}
/** The cache's budget of ids: SEARCH_PRICE_ORDER_MAX_IDS (blank or invalid: 1,000,000; at most 2^31-1). */
export function searchPriceOrderMaxIds() {
  const setting = process.env.SEARCH_PRICE_ORDER_MAX_IDS?.trim();
  const value = setting ? Number(setting) : defaultMaxIds;
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 2_147_483_647) : defaultMaxIds;
}

/** Packs a Postgres uuid[] text literal (`{a,b}` or `{}`) into 16 bytes per id. */
export function packIds(literal: string): Buffer {
  const hex = literal.replace(/[{},-]/g, "");
  const packed = Buffer.from(hex, "hex");
  if (hex.length % (idBytes * 2) !== 0 || packed.length * 2 !== hex.length) throw new Error("Malformed uuid array literal");
  return packed;
}
/** The number of ids in a packed order. */
export const idCount = (packed: Buffer) => packed.length / idBytes;
/** `take` ids from `offset` (0-based) as lowercase 8-4-4-4-12 text; fewer (or none) past the end. */
export function unpackIds(packed: Buffer, offset: number, take: number): string[] {
  const end = Math.min(idCount(packed), offset + take), ids: string[] = [];
  for (let index = Math.max(0, offset); index < end; index++) {
    const hex = packed.toString("hex", index * idBytes, (index + 1) * idBytes);
    ids.push(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
  return ids;
}
