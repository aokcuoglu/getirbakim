import "server-only";
import { db } from "@/lib/db";

/**
 * Storefront listing cache epochs (#585, #1368, db/product-overrides.sql storefront_listing_epoch). Listing counts, page
 * ids, facets and plain searches are cached per process (src/lib/stale-cache.ts); a change to what a listing shows bumps
 * a shared counter, and every process reloads entries loaded under an older value. The row holds two counters, read as
 * two values:
 * - listingEpoch(), `epoch`: bumped by admin edits (invalidateListings). Every cache follows it unless it reads vehicle fits.
 * - fitsEpoch(), epoch+fits_epoch: the background fit sync bumps fits_epoch (invalidateFits, enrichment-links.server.ts, up
 *   to every 30 s while fit rows change). The caches that read vehicle fits follow it (make, model and garage vehicle
 *   listings, fitted ids, listed models, a make's or model's category counts, searches that may name a vehicle).
 * So the fit sync no longer reloads the manufacturer, category and plain listings. Every bump moves the fits value, an
 * admin edit's too, as does a raw `UPDATE … SET epoch=epoch+1` (an app task still on the code before #1368 during a
 * rolling deploy); fits_epoch starts at 0 when setup adds it, so the fits value continues from the epoch the stored rows
 * carry. Each cache key reads one of the two values only, so the value its entries and stored rows carry only grows.
 * Each process reads the row at most once per `pollMs`, so another app container sees a bump within about a second; the
 * process that made it sees it at once. Database errors keep the last known values: they never empty the caches.
 * Until setup has added fits_epoch (a missing column, 42703), both values read `epoch` and both bumps move it, for five
 * minutes, after which the column is tried again (logged once per period); a bump never throws.
 * The listing counts, page ids and facets wait at most LISTING_EPOCH_WAIT_MS (250 ms, listing-wait.ts) for that reload
 * (#771, catalog.ts), and so do most fit caches (#1368): past it a visitor gets the replaced value (unless it is empty)
 * and the reload goes on, so a large listing shows an edit once its reload ends.
 * The known values only grow (Math.max), so a racing older read cannot undo a bump. If a counter is ever set back
 * (restoring a backup, recreating the table or the column) or the app is rolled back to a release before #1368 (it reads
 * `epoch` alone, below the fits value the make listings stored), restart the app tasks and TRUNCATE
 * storefront_listing_cache (#957) and storefront_listing_price_orders (#1369), or their caches keep serving until the
 * counter passes the old value (rows stored under a higher value would be adopted for up to 24 hours).
 */
const pollMs = 1000;
const legacyMs = 5 * 60 * 1000;
/** The highest value seen of each: `listing` (epoch) and `fits` (epoch+fits_epoch). */
const known = { listing: 0, fits: 0 };
let readAt = 0, legacyUntil = 0;
let reading: Promise<void> | null = null;

let lastErrorLog = 0;
function logError(message: string, error: unknown) {
  // A database outage would otherwise log on every request.
  if (Date.now() - lastErrorLog < 60_000) return;
  lastErrorLog = Date.now();
  console.error(`Listing epoch: ${message}`, error instanceof Error ? error.message : error);
}
type Row = { epoch: string; fits: string };
function advance(row: Row | undefined) {
  if (!row) return;
  known.listing = Math.max(known.listing, Number(row.epoch));
  known.fits = Math.max(known.fits, Number(row.fits));
}
/**
 * Runs `current` (it names fits_epoch) unless the column was found missing within the last five minutes; on a missing
 * column `legacy` (`epoch` alone) instead. A statement failed on the column changed nothing.
 */
async function withFits(current: () => Promise<{ rows: Row[] }>, legacy: () => Promise<{ rows: Row[] }>) {
  if (Date.now() >= legacyUntil) {
    try {
      return await current();
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "42703") throw error;
      legacyUntil = Date.now() + legacyMs;
      logError("fits_epoch is missing (setup not run yet); the fit caches follow the listing epoch for 5 minutes", error);
    }
  }
  return legacy();
}
const values = "epoch::text AS epoch,(epoch+fits_epoch)::text AS fits", legacyValues = "epoch::text AS epoch,epoch::text AS fits";

/** Reads both values from the database when the last read is older than a second; one read at a time. */
function poll(): Promise<void> {
  if (Date.now() - readAt < pollMs) return Promise.resolve();
  reading ??= withFits(() => db.query<Row>(`SELECT ${values} FROM storefront_listing_epoch LIMIT 1`),
    () => db.query<Row>(`SELECT ${legacyValues} FROM storefront_listing_epoch LIMIT 1`))
    .then(({ rows }) => advance(rows[0]))
    .catch(error => logError("read failed; keeping the last known values", error))
    .finally(() => { readAt = Date.now(); reading = null; });
  return reading;
}

/** The latest known listing epoch: what every cache that reads no vehicle fits follows. */
export function listingEpoch(): Promise<number> {
  return poll().then(() => known.listing);
}

/** The latest known fits value, epoch+fits_epoch: what the caches that read vehicle fits follow (#1368). */
export function fitsEpoch(): Promise<number> {
  return poll().then(() => known.fits);
}

/** Moves `counter` by one and takes the returned values; a failure is logged and not thrown. */
async function bump(counter: "epoch" | "fits_epoch") {
  const update = (returning: string) => db.query<Row>(`UPDATE storefront_listing_epoch SET ${counter}=${counter}+1,bumped_at=now() RETURNING ${returning}`);
  try {
    // Without the column the legacy bump moves `epoch`, which both values read then.
    const { rows } = await withFits(() => update(values), () => db.query<Row>(`UPDATE storefront_listing_epoch SET epoch=epoch+1,bumped_at=now() RETURNING ${legacyValues}`));
    if (rows[0]) { advance(rows[0]); readAt = Date.now(); }
  } catch (error) {
    logError("bump failed; listings refresh on their TTL", error);
  }
}

/**
 * Marks every cached listing as stale in all processes: `epoch` moves, and with it both values. Called after the edit
 * has committed; a failure is logged and not thrown (the edit is saved, and the listings still refresh on their own TTL).
 */
export function invalidateListings(): Promise<void> {
  return bump("epoch");
}

/**
 * Marks the cached listings that read vehicle fits as stale in all processes (#1368): fits_epoch moves, so only the fits
 * value does, and the manufacturer, category and plain listings keep their entries. Never throws, like invalidateListings.
 */
export function invalidateFits(): Promise<void> {
  return bump("fits_epoch");
}
