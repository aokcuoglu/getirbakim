import type { PoolClient } from "pg";

type Row = Record<string, unknown>;

// A bundle carries the complete category mappings of every enrichment it sends, so the target's mappings of those
// supplier items are replaced, not merged: a product whose categories changed must not keep the old ones. Only the
// sources the bundle carries (its category tree and mappings) are replaced. Products whose enrichment is not in this
// bundle (or not resolved here) keep their mappings. Call after resolveBundleItems in the same transaction.

/** Replaces the mappings of the bundle's enrichments; returns the rows removed and inserted. */
export async function replaceBundleMappings(client: PoolClient, manifest: { enrichments?: Row[]; products?: Row[]; categories?: Row[] }) {
  const sources = [...new Set([...(manifest.categories ?? []), ...(manifest.products ?? [])].map(row => row.source).filter(source => typeof source === "string"))];
  const removed = await client.query(`DELETE FROM product_source_categories p USING bundle_items bi
    WHERE p.supplier_item_id=bi.id AND p.source=ANY($2::text[])
    AND bi.bundle_id IN (SELECT r.supplier_item_id FROM jsonb_populate_recordset(null::product_enrichments,$1::jsonb) r)`,
  [JSON.stringify(manifest.enrichments ?? []), sources]);
  const inserted = await client.query(`INSERT INTO product_source_categories(supplier_item_id,source,category_id)
    SELECT bi.id,r.source,r.category_id FROM jsonb_populate_recordset(null::product_source_categories,$1::jsonb) r
    JOIN bundle_items bi ON bi.bundle_id=r.supplier_item_id AND bi.id IS NOT NULL
    ON CONFLICT DO NOTHING`, [JSON.stringify(manifest.products ?? [])]);
  return { removed: removed.rowCount ?? 0, inserted: inserted.rowCount ?? 0 };
}
