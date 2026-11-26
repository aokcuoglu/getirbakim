/**
 * Database failures that mean "too busy to answer in time" rather than a broken request (#1395): an API answers them
 * 503 with Retry-After instead of 500. Pure (no pool, no server-only), so the partner guard and its unit tests
 * (scripts/test-partner.ts) import it without a database.
 */

/** A statement the server cancelled (57014): its statement_timeout (boundedQuery's SET LOCAL), or a pg_cancel_backend. */
export function isStatementTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "57014";
}

// pg-pool's errors (node_modules/pg-pool/index.js, 3.x) when no client is ready within connectionTimeoutMillis
// (DATABASE_POOL_ACQUIRE_TIMEOUT_MS in src/lib/db.ts): every pooled client stayed busy, or a new connection did not open.
const poolTimeoutMessages = new Set(["timeout exceeded when trying to connect", "Connection terminated due to connection timeout"]);

/** The pool gave no connection in time. */
export function isPoolTimeout(error: unknown): boolean {
  return error instanceof Error && poolTimeoutMessages.has(error.message);
}
