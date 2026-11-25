import "server-only";

// Just under the 60 s after which the CDN (CloudFront's origin read timeout) and the internal load balancer (its idle
// timeout) give up a request still waiting for bytes: a visitor's read that answered within that still does, one of
// 55-60 s that answered before now fails. A load staleCache runs in the background (a TTL refresh, or an epoch reload whose
// visitors got the earlier value after the bounded wait, #771) serves no request, it only fills the cache: one past the
// limit never completes, so the key keeps its earlier value and the next request starts the read again, where an
// unbounded one finished late and filled it. boundedQuery logs every timeout and every read that took over 20 s
// (BOUNDED_QUERY_SLOW_MS), so production shows how close the loads come to the limit.
const defaultLimitMs = 55_000;

/**
 * The server-side limit of a catalog listing or search read (#1377, listingQuery in catalog.ts): LISTING_STATEMENT_TIMEOUT_MS,
 * read per call. Blank or invalid: 55 s. 0 turns it off, the rollback: the reads go out as plain statements again.
 */
export function listingStatementTimeoutMs(): number {
  const setting = process.env.LISTING_STATEMENT_TIMEOUT_MS?.trim();
  if (!setting) return defaultLimitMs;
  const value = Number(setting);
  if (value === 0) return 0;
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : defaultLimitMs;
}
