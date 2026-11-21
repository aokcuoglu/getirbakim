import type { Pool } from "pg";

/**
 * Whole-table maintenance scripts/setup.ts runs after its schema transaction commits (#1054). Inside the transaction
 * every view lock taken before it is held until COMMIT, so readers would wait for it: rebuilding the "did you mean"
 * vocabulary (ts_stat over every present supplier_items row) took ~39 s on 1.29M rows locally, the two ANALYZEs ~2 s.
 * Each statement runs on its own on one connection; none needs the schema locks. ANALYZE waits behind a running VACUUM,
 * REINDEX or CREATE INDEX CONCURRENTLY on the table, so the connection gives up after 60 s instead of stalling setup.
 * Small and never-analyzed tables are analyzed too (#994): autovacuum analyzes a table only after 50 changed rows plus
 * 10% of it, so a settings table of one row or a new derived table can keep no statistics (reltuples -1) for good and
 * the planner guesses its size.
 */
export async function postSetupMaintenance(pool: Pool) {
  const client = await pool.connect();
  const code = (error: unknown) => (error as { code?: string }).code ?? "unknown";
  const timed = async (label: string, sql: string) => {
    const started = Date.now();
    await client.query(sql);
    console.log(`${label} in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  };
  try {
    await client.query("SET lock_timeout = '60s'");
    // Expression statistics only exist after ANALYZE; without them the planner guesses the search matches thousands of
    // rows and seq-scans supplier_items (~5 s instead of <1 ms).
    for (const table of ["supplier_items", "vehicle_types"]) {
      try {
        await timed(`Analyzed ${table}`, `ANALYZE ${table}`);
      } catch (error) {
        if (code(error) !== "55P03") throw error;
        throw new Error(`ANALYZE ${table} waited 60 s for a lock (VACUUM, REINDEX or a concurrent index build on it?); run it once that finishes.`, { cause: error });
      }
    }
    // Ordinary tables of this schema up to 1 MB or never analyzed: each takes milliseconds, the whole set well under a
    // second. A lock wait skips the table; the next setup analyzes it.
    const { rows: small } = await client.query<{ name: string }>(`SELECT c.oid::regclass::text AS name FROM pg_class c
      WHERE c.relnamespace=current_schema()::regnamespace AND c.relkind='r' AND c.relpersistence='p'
       AND (c.reltuples<0 OR pg_relation_size(c.oid)<=1048576) ORDER BY 1`);
    const started = Date.now();
    let skipped = 0;
    for (const { name } of small) {
      try {
        await client.query(`ANALYZE ${name}`);
      } catch (error) {
        if (code(error) !== "55P03") throw error;
        skipped++;
        console.warn(`ANALYZE ${name} waited 60 s for a lock; skipped.`);
      }
    }
    console.log(`Analyzed ${small.length - skipped} small or never-analyzed tables in ${((Date.now() - started) / 1000).toFixed(1)} s${skipped ? ` (${skipped} skipped)` : ""}.`);
    // A failed rebuild keeps the previous words, as in the supplier scheduler (scripts/sync-suppliers.ts): reported, not
    // fatal. A scheduler rebuilding at the same time can make this one fail with a duplicate word (23505).
    try {
      await timed("Rebuilt search vocabulary", "SELECT refresh_search_vocabulary()");
    } catch (error) {
      console.warn(`Search vocabulary rebuild failed (${code(error)}${code(error) === "23505" ? ", likely a concurrent scheduler rebuild" : ""}); the previous words are kept.`);
      return;
    }
    try {
      await timed("Analyzed search_vocabulary", "ANALYZE search_vocabulary");
    } catch (error) {
      console.warn(`ANALYZE search_vocabulary failed (${code(error)}); the words are rebuilt but not analyzed.`);
    }
  } finally {
    // The pool hands this connection to setup's later syncs, which must not inherit the timeout.
    await client.query("RESET lock_timeout").catch(() => undefined);
    client.release();
  }
}
