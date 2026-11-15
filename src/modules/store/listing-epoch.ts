import "server-only";
import { db } from "@/lib/db";

/**
 * Storefront listing cache epoch (#585, db/product-overrides.sql storefront_listing_epoch). Listing counts, page ids,
 * facets and plain searches are cached per process (src/lib/stale-cache.ts); an admin edit that changes what a listing
 * shows bumps the shared counter, and every process drops entries loaded under an older value. Each process reads the
 * counter at most once per `pollMs`, so another app container sees an edit within about a second; the process that
 * made the edit sees it at once. Database errors keep the last known value: they never empty the caches.
 * The known value only grows (Math.max), so a racing older read cannot undo a bump; if the counter is ever set back
 * (restoring a backup, recreating the table), restart the app tasks or their caches keep serving until the counter
 * passes the old value.
 */
const pollMs = 1000;
let known = 0, readAt = 0;
let reading: Promise<number> | null = null;

let lastErrorLog = 0;
function logError(message: string, error: unknown) {
  // A database outage would otherwise log on every request.
  if (Date.now() - lastErrorLog < 60_000) return;
  lastErrorLog = Date.now();
  console.error(`Listing epoch: ${message}`, error instanceof Error ? error.message : error);
}

/** The latest known epoch; read from the database when the last read is older than a second. */
export function listingEpoch(): Promise<number> {
  if (Date.now() - readAt < pollMs) return Promise.resolve(known);
  reading ??= db.query<{ epoch: string }>("SELECT epoch::text AS epoch FROM storefront_listing_epoch LIMIT 1")
    .then(({ rows }) => { if (rows[0]) known = Math.max(known, Number(rows[0].epoch)); return known; })
    .catch(error => { logError("read failed; keeping the last known value", error); return known; })
    .finally(() => { readAt = Date.now(); reading = null; });
  return reading;
}

/**
 * Marks every cached listing as stale in all processes. Called after the edit has committed; a failure is logged and
 * not thrown (the edit is saved, and the listings still refresh on their own TTL).
 */
export async function invalidateListings(): Promise<void> {
  try {
    const { rows } = await db.query<{ epoch: string }>(
      "UPDATE storefront_listing_epoch SET epoch=epoch+1,bumped_at=now() RETURNING epoch::text AS epoch");
    if (rows[0]) { known = Math.max(known, Number(rows[0].epoch)); readAt = Date.now(); }
  } catch (error) {
    logError("bump failed; listings refresh on their TTL", error);
  }
}
