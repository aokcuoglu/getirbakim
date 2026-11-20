import "server-only";
import { db } from "@/lib/db";

/**
 * Keeps product_enrichment_shared_links (db/enrichment-shared-links.sql), which the storefront reads through
 * storefront_enrichments, current: writers queue the products and offers they touch, and this drains the queue.
 * A queued product is recomputed in milliseconds; a full rebuild (brand mapping, deployment) takes ~10-20 s while
 * readers keep the previous rows. The database lock lets one app container work at a time; the others skip.
 */
export function syncEnrichmentLinks() {
  return db.query<{ written: number }>("SELECT product_enrichment_shared_sync() AS written").then(result => result.rows[0].written);
}

/**
 * Rebuilds the Dinamik price-list-only cards (storefront_price_only_items, db/storefront-catalog.sql, #1068) from the
 * enrichment links and their categories; writes only what changed. Returns 0 while another container runs it.
 */
export function refreshPriceOnlyItems() {
  return db.query<{ written: number }>("SELECT storefront_price_only_refresh() AS written").then(result => result.rows[0].written);
}
// The rebuild reads every link (~0.3 s on ~165k links): at most once a minute after links changed, and every 10 minutes
// anyway, since category labels and category-only imports do not move the links.
const priceOnlyChangedMs = 60 * 1000, priceOnlyMaxAgeMs = 10 * 60 * 1000;

const started = globalThis as unknown as { getirbakimEnrichmentLinkSync?: boolean };
/**
 * Runs syncEnrichmentLinks every `intervalMs` in the server process, then refreshPriceOnlyItems (a minute after links
 * changed, else every 10 minutes); one run at a time, failures logged once a minute.
 */
export function startEnrichmentLinkSync(intervalMs: number) {
  if (started.getirbakimEnrichmentLinkSync || !(intervalMs > 0)) return;
  started.getirbakimEnrichmentLinkSync = true;
  let running = false, lastError = 0, priceOnlyAt = 0, linksChanged = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (await syncEnrichmentLinks() > 0) linksChanged = true;
      if (Date.now() - priceOnlyAt > (linksChanged ? priceOnlyChangedMs : priceOnlyMaxAgeMs)) {
        await refreshPriceOnlyItems();
        priceOnlyAt = Date.now();
        linksChanged = false;
      }
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
