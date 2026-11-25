import "server-only";

// Just under the 60 s after which the CDN (CloudFront's origin read timeout) and the internal load balancer (its idle
// timeout) give the request up: a read past it serves nobody, while one that finishes sooner still answers its page.
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
