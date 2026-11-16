interface Queryable {
  query: (text: string) => Promise<unknown>;
}

/**
 * Drains the storefront enrichment queue the way product_enrichment_shared_sync() does, without its lock: the queued
 * ids are the refresh scope (so the triggers stay covered), and the rebuild marker means everything. The function's
 * batch limit (a queue above 20000 rebuilds everything) is not mirrored; tests never queue that much.
 * product_enrichment_shared_sync() takes a database-wide try-lock (20261001,9) and silently does nothing while another
 * session holds it, e.g. a local dev server that syncs every few seconds.
 */
export const syncSharedLinks = (pool: Queryable) => pool.query(`
  WITH taken AS (DELETE FROM product_enrichment_shared_queue RETURNING kind,id)
  SELECT product_enrichment_shared_refresh(
    CASE WHEN COALESCE(bool_or(kind='p' AND id='00000000-0000-0000-0000-000000000000'),false) THEN NULL
      ELSE COALESCE(array_agg(id) FILTER (WHERE kind='p'),'{}') END,
    COALESCE(array_agg(id) FILTER (WHERE kind='i'),'{}')) FROM taken`);
