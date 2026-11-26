import "server-only";

// Just under the 60 s after which the CDN (CloudFront's origin read timeout) and the internal load balancer (its idle
// timeout) give up a request still waiting for bytes: a visitor's read that answered within that still does, one of
// 55-60 s that answered before now fails. A load staleCache runs in the background (a TTL refresh, or an epoch reload whose
// visitors got the earlier value after the bounded wait, #771) serves no request, it only fills the cache: one past the
// limit never completes, so the key keeps its earlier value and the next request starts the read again, where an
// unbounded one finished late and filled it. boundedQuery logs every timeout and every read that took over 20 s
// (BOUNDED_QUERY_SLOW_MS), so production shows how close the loads come to the limit.
export const defaultListingLimitMs = 55_000;

/**
 * The server-side limit of a catalog listing or search read (#1377, listingQuery in catalog.ts): LISTING_STATEMENT_TIMEOUT_MS,
 * read per call. Blank or invalid: 55 s. 0 turns it off, the rollback: the reads go out as plain statements again.
 */
export function listingStatementTimeoutMs(): number {
  const setting = process.env.LISTING_STATEMENT_TIMEOUT_MS?.trim();
  if (!setting) return defaultListingLimitMs;
  const value = Number(setting);
  if (value === 0) return 0;
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : defaultListingLimitMs;
}

// The header type-ahead asks again on the next keystroke, and nobody waits 55 s for a suggestion (#1398).
const defaultSuggestLimitMs = 5_000;

/**
 * The server-side limit of a type-ahead read (suggestProducts and its search, catalog.ts): SUGGEST_STATEMENT_TIMEOUT_MS,
 * read per call. Blank or invalid: 5 s. 0: the listing limit (listingStatementTimeoutMs). A load that fails on it is not
 * cached but held (searchFailureHoldMs), so a search that always takes longer is not read again on every keystroke.
 */
export function suggestStatementTimeoutMs(): number {
  const setting = process.env.SUGGEST_STATEMENT_TIMEOUT_MS?.trim();
  if (!setting) return defaultSuggestLimitMs;
  const value = Number(setting);
  if (value === 0) return listingStatementTimeoutMs();
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : defaultSuggestLimitMs;
}

const defaultSearchFailureHoldMs = 30_000;

/**
 * How long a search read that failed on a limit stays failed (#1416): SEARCH_FAILURE_HOLD_MS, read per call. Blank or
 * invalid: 30 s. 0 turns it off: every request tries the read again. Holds a type-ahead hit set, a spell-correction scope
 * and the synonym load.
 */
export function searchFailureHoldMs(): number {
  const setting = process.env.SEARCH_FAILURE_HOLD_MS?.trim();
  if (!setting) return defaultSearchFailureHoldMs;
  const value = Number(setting);
  if (value === 0) return 0;
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : defaultSearchFailureHoldMs;
}
