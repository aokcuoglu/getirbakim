interface Queryable {
  query: (text: string) => Promise<unknown>;
}

/**
 * Rebuilds the storefront enrichment links for the schema the pool points at.
 * product_enrichment_shared_sync() takes a database-wide try-lock (20261001,9) and silently does nothing while another
 * session holds it, e.g. a local dev server that syncs every few seconds. Tests drain the queue and call the refresh,
 * which takes no lock.
 */
export const syncSharedLinks = (pool: Queryable) =>
  pool.query("DELETE FROM product_enrichment_shared_queue; SELECT product_enrichment_shared_refresh(NULL,NULL)");
