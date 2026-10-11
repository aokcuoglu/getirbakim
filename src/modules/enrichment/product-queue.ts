import type { Pool, PoolClient } from "pg";

/** Preserve all historical observations/checkpoints; retire only queued offers that no longer need a source visit. */
export async function reconcileProductQueue(pool: Pool | PoolClient, runId: string) {
  await pool.query(`UPDATE enrichment_run_items i SET product_id=s.product_id FROM product_sources s
    WHERE i.run_id=$1 AND s.supplier_item_id=i.supplier_item_id AND i.product_id IS NULL`, [runId]);
  const result = await pool.query(`WITH candidates AS MATERIALIZED (
    SELECT DISTINCT ON (product_id) product_id,status FROM enrichment_product_candidates
    WHERE coherent AND product_id IN(SELECT product_id FROM enrichment_run_items WHERE run_id=$1 AND status IN ('queued','collecting'))
    ORDER BY product_id,priority,present DESC,oem<>'' DESC,supplier_item_id=product_id DESC,supplier_item_id
   ), ranked AS (
    SELECT i.supplier_item_id,c.status AS product_status,c.product_id,
      row_number() OVER(PARTITION BY c.product_id ORDER BY i.status='collecting' DESC,
        i.stage<>'search' DESC,i.ordinal) AS position
    FROM enrichment_run_items i LEFT JOIN enrichment_current_sources ps ON ps.supplier_item_id=i.supplier_item_id AND ps.product_id=i.product_id
    LEFT JOIN candidates c ON c.product_id=ps.product_id
    WHERE i.run_id=$1 AND i.status IN ('queued','collecting')
   ) UPDATE enrichment_run_items i SET status='skipped',finished_at=now(),lease_token=NULL,lease_until=NULL,
    last_error='Source visit superseded by master product scope or existing product outcome'
   FROM ranked r WHERE i.run_id=$1 AND i.supplier_item_id=r.supplier_item_id AND i.status='queued'
    AND (r.product_id IS NULL OR r.product_status<>'pending' OR r.position>1)
   RETURNING i.supplier_item_id`, [runId]);
  return result.rowCount ?? 0;
}

export async function enqueueProductSources(pool: Pool | PoolClient) {
  return (await pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,oem)
    SELECT c.supplier_item_id,c.supplier_code,c.supplier_brand,c.oem FROM enrichment_product_catalog c
    WHERE c.supplier_item_id IS NOT NULL
    ON CONFLICT(supplier_item_id) DO UPDATE SET supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,
      oem=EXCLUDED.oem,status='pending',last_error=NULL,updated_at=now()
    WHERE product_enrichment_jobs.supplier_code<>EXCLUDED.supplier_code
      OR product_enrichment_jobs.supplier_brand<>EXCLUDED.supplier_brand
      OR product_enrichment_jobs.oem<>EXCLUDED.oem`)).rowCount ?? 0;
}
