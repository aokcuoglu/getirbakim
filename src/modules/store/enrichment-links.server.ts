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

const started = globalThis as unknown as { getirbakimEnrichmentLinkSync?: boolean };
/** Runs syncEnrichmentLinks every `intervalMs` in the server process; one run at a time, failures logged once a minute. */
export function startEnrichmentLinkSync(intervalMs: number) {
  if (started.getirbakimEnrichmentLinkSync || !(intervalMs > 0)) return;
  started.getirbakimEnrichmentLinkSync = true;
  let running = false, lastError = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await syncEnrichmentLinks(); }
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
