import type { PoolClient } from "pg";

type Row = Record<string, unknown>;

// product_enrichments has no status: the storefront shows an enrichment only while its job is complete or partial
// (enrichment_valid_data in db/enrichment-products.sql). The bundle therefore carries those job statuses, and this
// writes them into product_enrichment_jobs for the supplier items resolved in bundle_items (storefront-bundle-items.ts).
// Only rows that actually change are written: product_enrichment_jobs has statement triggers that queue every written
// row for enrichment_product_states and product_enrichment_shared_links, and the bundle repeats every job each run
// (~198k on 2026-11-24). Since #1317 those jobs are spread over the job parts after part-00: only the rows given here
// are written, a job missing from them is never deleted or reset.

/** Upserts the bundle's job statuses; call after resolveBundleItems in the same transaction. */
export async function importBundleJobs(client: PoolClient, jobs: Row[]) {
  const json = JSON.stringify(jobs);
  // oem is compared and rewritten because enrichment_product_candidates (db/enrichment-products.sql) counts a failed job
  // only while its oem matches the supplier row (#1386); candidate_url and last_attempt_at are never read on the target.
  // DISTINCT ON keeps the latest attempt among this part's jobs that resolve to one local item. Across job parts the
  // later part wins instead; that needs two bundle jobs resolving to one item here (same id, different natural key on
  // each side), so it is theoretical.
  const written = await client.query(`INSERT INTO product_enrichment_jobs AS j(supplier_item_id,supplier_code,supplier_brand,oem,status,candidate_url,attempts,last_attempt_at)
    SELECT DISTINCT ON (bi.id) bi.id,r.supplier_code,r.supplier_brand,coalesce(r.oem,''),r.status,r.candidate_url,1,r.last_attempt_at
    FROM jsonb_populate_recordset(null::product_enrichment_jobs,$1::jsonb) r JOIN bundle_items bi ON bi.bundle_id=r.supplier_item_id AND bi.id IS NOT NULL
    ORDER BY bi.id,r.last_attempt_at DESC NULLS LAST
    ON CONFLICT (supplier_item_id) DO UPDATE SET status=EXCLUDED.status,supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,
    oem=EXCLUDED.oem,candidate_url=EXCLUDED.candidate_url,last_error=NULL,updated_at=now()
    WHERE ROW(j.status,j.supplier_code,j.supplier_brand,j.oem) IS DISTINCT FROM ROW(EXCLUDED.status,EXCLUDED.supplier_code,EXCLUDED.supplier_brand,EXCLUDED.oem)`, [json]);
  const skipped = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM jsonb_populate_recordset(null::product_enrichment_jobs,$1::jsonb) r
    WHERE NOT EXISTS (SELECT 1 FROM bundle_items bi WHERE bi.bundle_id=r.supplier_item_id AND bi.id IS NOT NULL)`, [json]);
  return { jobs: written.rowCount ?? 0, skipped: skipped.rows[0].count };
}
