import type { PoolClient } from "pg";

// Writes the bundle's product enrichments for the supplier items resolved in bundle_items (storefront-bundle-items.ts),
// with their images from bundle_media; rows of supplier items missing here are left out (the import counts them).
//
// The upsert must stay unconditional (no `WHERE ... IS DISTINCT FROM` as in storefront-bundle-jobs.ts): RETURNING
// lists only rows it writes, and those ids are the scope of the fitment rebuild (rebuild-product-fitments.ts --items).
// A retried or re-sent enrichment whose row is unchanged here may still lack its fitments, so it must come back too.

/** Upserts the bundle's enrichments (`serialised`: their JSON, when the caller already holds it); returns the count and the local supplier items written. */
export async function importBundleEnrichments(client: PoolClient, enrichments: unknown[], serialised = JSON.stringify(enrichments)) {
  const result = await client.query<{ supplier_item_id: string }>(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload,imported_at,match_basis)
    SELECT DISTINCT ON (bi.id) bi.id,r.supplier_code,r.supplier_brand,r.source_url,r.source_method,r.manufacturer,r.manufacturer_part_number,bm.id,r.payload,r.imported_at,r.match_basis
    FROM jsonb_populate_recordset(null::product_enrichments,$1::jsonb) r JOIN bundle_items bi ON bi.bundle_id=r.supplier_item_id AND bi.id IS NOT NULL
    LEFT JOIN bundle_media bm ON bm.bundle_id=r.image_id
    ORDER BY bi.id,r.imported_at DESC
    ON CONFLICT (supplier_item_id) DO UPDATE SET supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,source_url=EXCLUDED.source_url,
    source_method=EXCLUDED.source_method,manufacturer=EXCLUDED.manufacturer,manufacturer_part_number=EXCLUDED.manufacturer_part_number,image_id=EXCLUDED.image_id,
    payload=EXCLUDED.payload,imported_at=EXCLUDED.imported_at,match_basis=EXCLUDED.match_basis
    RETURNING supplier_item_id::text`, [serialised]);
  return { written: result.rowCount ?? 0, items: result.rows.map(row => row.supplier_item_id) };
}
