import type { PoolClient } from "pg";
import type { BundleItem } from "./storefront-bundle-items";
import type { Tombstone } from "./storefront-bundle-tombstones";

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

// Rows read per query while the export streams the job statuses and supplier item keys to jobs.ndjson / items.ndjson (#1357).
export const KEYSET_BATCH = 5000;

type Keyed = { [column: string]: unknown };

/**
 * Reads a query in keyset batches inside the caller's snapshot. `sql` must select `key` (a unique uuid, the sort column), order by it
 * and end with `LIMIT $n`; its last two parameters are the previous batch's last key (NULL for the first batch) and the batch size.
 */
async function* keysetBatches<T extends Keyed>(client: PoolClient, key: keyof T & string, sql: string, params: unknown[], size: number) {
  let after: string | null = null;
  for (;;) {
    const { rows }: { rows: T[] } = await client.query<T>(sql, [...params, after, size]);
    if (rows.length) yield rows;
    if (rows.length < size) return;
    after = String(rows[rows.length - 1][key]);
  }
}

/** The complete/partial job statuses of enriched products ordered by supplier_item_id (the primary key), one keyset batch at a time. */
export function exportedJobBatches(client: PoolClient, size = KEYSET_BATCH) {
  return keysetBatches<Record<string, unknown>>(client, "supplier_item_id",
    `SELECT j.supplier_item_id,j.supplier_code,j.supplier_brand,j.oem,j.status,j.candidate_url,j.last_attempt_at
      FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id)
      WHERE j.status IN ('complete','partial') AND ($1::uuid IS NULL OR j.supplier_item_id>$1::uuid) ORDER BY j.supplier_item_id LIMIT $2`, [], size);
}

/** The supplier item keys the bundle references (exported enrichments, logo evidence, complete/partial jobs) ordered by id, one keyset batch at a time. `changed` is [watermark, retry JSON]. */
export function exportedItemBatches(client: PoolClient, changed: unknown[], size = KEYSET_BATCH) {
  return keysetBatches<Record<string, unknown>>(client, "id",
    `SELECT id,supplier,company,list_group,warehouse,code FROM supplier_items WHERE ($3::uuid IS NULL OR id>$3::uuid) AND id IN (
      SELECT supplier_item_id FROM (${EXPORTED_ENRICHMENT_IDS}
        UNION SELECT evidence_product_id FROM manufacturer_logos
        UNION SELECT j.supplier_item_id FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id) WHERE j.status IN ('complete','partial')) u
      WHERE ($3::uuid IS NULL OR supplier_item_id>$3::uuid))
      ORDER BY id LIMIT $4`, changed, size);
}

/** Writes every job status in order; resolves to the row count. */
export async function streamJobs(client: PoolClient, write: (row: unknown) => Promise<void>, size = KEYSET_BATCH) {
  let count = 0;
  for await (const rows of exportedJobBatches(client, size)) for (const row of rows) { await write(row); count++; }
  return count;
}

/**
 * Writes the supplier item keys in id order, then the keys of the tombstones whose supplier item was not among them, in tombstone
 * order and once per id (the item may be gone here, so its key comes from the log); resolves to the row count.
 */
export async function streamItems(client: PoolClient, changed: unknown[], tombstones: Pick<Tombstone, "supplier_item_id" | "supplier" | "company" | "list_group" | "warehouse" | "code">[],
  write: (row: unknown) => Promise<void>, size = KEYSET_BATCH) {
  // Tombstones are bounded by the retention window; only their ids are tracked, never the (large) item id set.
  const pending = new Set(tombstones.map(tombstone => tombstone.supplier_item_id));
  let count = 0;
  for await (const rows of exportedItemBatches(client, changed, size)) {
    for (const row of rows) { await write(row); pending.delete(String(row.id)); count++; }
  }
  for (const { supplier_item_id: id, supplier, company, list_group, warehouse, code } of tombstones) {
    if (!pending.delete(id)) continue;
    const item: BundleItem = { id, supplier, company, list_group, warehouse, code };
    await write(item);
    count++;
  }
  return count;
}
