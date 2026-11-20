import type { Pool } from "pg";

/**
 * Whole-table maintenance scripts/setup.ts runs after its schema transaction commits (#1054). Inside the transaction
 * every view lock taken before it is held until COMMIT, so readers would wait for it: rebuilding the "did you mean"
 * vocabulary (ts_stat over every present supplier_items row) took ~39 s on 1.29M rows locally, the two ANALYZEs ~2 s.
 * Each statement runs on its own; none needs the schema locks.
 */
export async function postSetupMaintenance(pool: Pool) {
  const timed = async (label: string, sql: string) => {
    const started = Date.now();
    await pool.query(sql);
    console.log(`${label} in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  };
  // Expression statistics only exist after ANALYZE; without them the planner guesses the search matches thousands of
  // rows and seq-scans supplier_items (~5 s instead of <1 ms).
  await timed("Analyzed supplier_items", "ANALYZE supplier_items");
  await timed("Analyzed vehicle_types", "ANALYZE vehicle_types");
  // A failed rebuild keeps the previous words, as in the supplier scheduler (scripts/sync-suppliers.ts): reported, not fatal.
  try {
    await timed("Rebuilt search vocabulary", "SELECT refresh_search_vocabulary()");
    await timed("Analyzed search_vocabulary", "ANALYZE search_vocabulary");
  } catch (error) {
    console.warn(`Search vocabulary rebuild failed (${(error as { code?: string }).code ?? "unknown"}); keeping the previous words.`);
  }
}
