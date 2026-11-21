import type { Pool } from "pg";

// Drains the queues that derive storefront tables from product_enrichments, for scripts that must not finish before
// those tables are current (import-storefront-inbound.ts, enrichment-states.ts, placeholder-images.ts clean).

/**
 * product_enrichment_shared_links and the make/model fits, then the price-only cards (#1068). product_enrichment_shared_sync()
 * returns 0 while another caller (the app) holds its lock, and that caller's pass empties the queue, so this waits for an
 * empty queue either way. priceOnly is null when an app task was rebuilding at that moment.
 */
export async function drainSharedLinks(pool: Pool) {
  let sharedLinks = 0;
  // A full refresh by the app (a large queue) can take minutes.
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    sharedLinks += (await pool.query<{ n: number }>("SELECT product_enrichment_shared_sync() AS n")).rows[0].n;
    if (!(await pool.query("SELECT 1 FROM product_enrichment_shared_queue LIMIT 1")).rowCount) break;
    if (Date.now() > deadline) throw new Error("The shared-link queue is still busy after 10 minutes.");
    await new Promise(done => setTimeout(done, 1000));
  }
  const priceOnly = (await pool.query<{ n: number | null }>("SELECT storefront_price_only_refresh() AS n")).rows[0].n;
  return { sharedLinks, priceOnly };
}

/** enrichment_product_states (db/enrichment-states.sql): drains its change queue; another reader's pass drains it too. */
export async function syncEnrichmentStates(pool: Pool) {
  let written = 0;
  for (let attempt = 0; ; attempt++) {
    written += (await pool.query<{ n: number }>("SELECT enrichment_product_states_sync() AS n")).rows[0].n;
    if (!(await pool.query("SELECT 1 FROM enrichment_product_state_queue LIMIT 1")).rowCount) break;
    if (attempt >= 60) throw new Error("The state queue is still busy after 60 attempts.");
    await new Promise(done => setTimeout(done, 1000));
  }
  return written;
}
