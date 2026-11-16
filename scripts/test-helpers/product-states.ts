interface Queryable {
  query: (text: string) => Promise<unknown>;
}

/**
 * Drains the enrichment state queue the way enrichment_product_states_sync() does, without its lock: the queued ids are
 * the refresh scope (so the queueing triggers stay covered), and the rebuild marker or a queue above the function's
 * default batch (20000) means everything. enrichment_product_states_sync() takes a database-wide try-lock (20261001,5)
 * and silently returns 0 while another session holds it, e.g. a local dev server or a supplier sync.
 */
export const syncProductStates = (pool: Queryable) => pool.query(`
  WITH taken AS (DELETE FROM enrichment_product_state_queue RETURNING product_id)
  SELECT CASE WHEN count(*)=0 THEN 0
    WHEN count(*)>20000 OR COALESCE(bool_or(product_id='00000000-0000-0000-0000-000000000000'),false)
      THEN enrichment_product_states_refresh(NULL)
    ELSE enrichment_product_states_refresh(array_agg(product_id)) END FROM taken`);
