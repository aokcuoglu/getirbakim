import "server-only";
import { db } from "@/lib/db";
import { invalidateListings } from "./listing-epoch";
import { fitsBumpDue } from "./listing-bump";

/**
 * Keeps product_enrichment_shared_links (db/enrichment-shared-links.sql), which the storefront reads through
 * storefront_enrichments, current: writers queue the products and offers they touch, and this drains the queue.
 * A queued product is recomputed in milliseconds; a full rebuild (brand mapping, deployment) takes ~10-20 s while
 * readers keep the previous rows. The database lock lets one app container work at a time; the others skip.
 * `fitsChanged` counts the make, description make and model fit rows the same pass changed (storefront_fits_sync, #956).
 */
export function syncEnrichmentLinks() {
  return db.query<{ written: number; fits_changed: string }>("SELECT written,fits_changed::text FROM storefront_fits_sync()")
    .then(result => ({ written: result.rows[0].written, fitsChanged: Number(result.rows[0].fits_changed) }));
}

/**
 * Rebuilds the Dinamik price-list-only cards (storefront_price_only_items, db/storefront-catalog.sql, #1068) from the
 * enrichment links and their categories; writes only what changed. With `minIntervalSeconds` the database skips it when
 * any task rebuilt within that time. Returns the rows written, or null when skipped (another task runs it, or too soon).
 */
export function refreshPriceOnlyItems(minIntervalSeconds?: number) {
  return db.query<{ written: number | null }>("SELECT storefront_price_only_refresh(make_interval(secs=>$1)) AS written",
    [minIntervalSeconds ?? null]).then(result => result.rows[0].written);
}
// The rebuild reads every link (~0.3 s on ~165k links; ~1.5 s with 100k qualifying codes, #1081): at most once a minute
// (across all tasks) after links changed, and every 10 minutes anyway, since category labels and category-only imports
// do not move the links.
const priceOnlyChangedSeconds = 60, priceOnlyMaxAgeSeconds = 10 * 60;

const started = globalThis as unknown as { getirbakimEnrichmentLinkSync?: boolean };
/**
 * Runs syncEnrichmentLinks every `intervalMs` in the server process, then refreshPriceOnlyItems (due a minute after links
 * changed, else every 10 minutes, counted across tasks in the database); one run at a time, failures logged once a minute.
 * Changed fit rows bump the listing epoch (throttled, see listing-bump.ts): only the task holding the sync lock sees
 * them, and the epoch reaches every task.
 */
export function startEnrichmentLinkSync(intervalMs: number) {
  if (started.getirbakimEnrichmentLinkSync || !(intervalMs > 0)) return;
  started.getirbakimEnrichmentLinkSync = true;
  let running = false, lastError = 0, linksChanged = false, fitsPending = false, lastFitsBump = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { written, fitsChanged } = await syncEnrichmentLinks();
      if (written > 0) linksChanged = true;
      if (fitsChanged > 0) fitsPending = true;
      if (fitsBumpDue(fitsPending, lastFitsBump, Date.now())) {
        fitsPending = false;
        lastFitsBump = Date.now();
        await invalidateListings();
      }
      // A cheap check in the database when it is not due; a change seen here waits until some task's rebuild.
      if (await refreshPriceOnlyItems(linksChanged ? priceOnlyChangedSeconds : priceOnlyMaxAgeSeconds) !== null) linksChanged = false;
    }
    catch (error) {
      if (Date.now() - lastError > 60_000) {
        lastError = Date.now();
        console.error("Storefront enrichment link sync failed", error instanceof Error ? error.message : error);
      }
    } finally { running = false; }
  };
  setInterval(tick, intervalMs).unref();
  setTimeout(tick, 1_000).unref();
}
