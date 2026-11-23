import type { PoolClient } from "pg";

// The enrichments an export carries: those imported after $1 (the watermark), plus the supplier items in $2 (a JSON
// array of bundle items, the sync's retry list of enrichments the target skipped), matched by id or by natural key.
// A product whose enrichment the target could not place yet is therefore sent again whatever the watermark says.
const RETRY_ITEMS = "jsonb_to_recordset($2::jsonb) AS r(id uuid, supplier text, company text, list_group text, warehouse text, code text)";
export const EXPORTED_ENRICHMENT_IDS = `SELECT supplier_item_id FROM product_enrichments WHERE imported_at>$1
  UNION SELECT e.supplier_item_id FROM product_enrichments e JOIN ${RETRY_ITEMS} ON r.id=e.supplier_item_id
  UNION SELECT e.supplier_item_id FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
    JOIN ${RETRY_ITEMS} ON (s.supplier,s.company,s.list_group,s.warehouse,s.code)=(r.supplier,r.company,r.list_group,r.warehouse,r.code)`;

// Enrichment rows read per query while the export streams them to enrichments.ndjson (#1316).
export const ENRICHMENT_BATCH = 200;

/** The exported supplier item ids in export order, evaluated once: imported_at has no index, so each evaluation scans the table. */
export async function exportedEnrichmentIds(client: PoolClient, changed: unknown[]) {
  const { rows } = await client.query<{ id: string }>(`SELECT supplier_item_id::text AS id FROM (${EXPORTED_ENRICHMENT_IDS}) ids ORDER BY supplier_item_id`, changed);
  return rows.map(row => row.id);
}

/** The product_enrichments rows of `ids`, one batch per consecutive slice, in the order of `ids`. */
export async function* exportedEnrichmentBatches(client: PoolClient, ids: string[], size = ENRICHMENT_BATCH) {
  for (let start = 0; start < ids.length; start += size) {
    yield (await client.query<Record<string, unknown>>("SELECT * FROM product_enrichments WHERE supplier_item_id = ANY($1::uuid[]) ORDER BY supplier_item_id",
      [ids.slice(start, start + size)])).rows;
  }
}
