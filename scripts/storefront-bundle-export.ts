import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { BundleItem } from "./storefront-bundle-items";
import type { Tombstone } from "./storefront-bundle-tombstones";

// Part of the vehicle data digest (#1359): raise it when the exported REPXPERT rows change shape or meaning without their values
// changing (a new column, another format), so the next sync sends the data in full whatever the target confirmed before.
export const VEHICLE_DATA_VERSION = 1;

/**
 * The digest of the REPXPERT vehicle data an export would carry (#1359): sha256 hex over VEHICLE_DATA_VERSION, the exported
 * spec rows, the image rows and [id, sha256, size_bytes] of their media rows, each in its SQL order (a Date serialises as
 * its ISO text, so the same rows give the same digest). The sync omits the data while it equals the digest the target
 * last confirmed (export-storefront-bundle.ts --vehicle-digest).
 */
export function vehicleDataDigest(specs: unknown[], images: unknown[], media: { id: string; sha256: string; size_bytes: number | string }[]) {
  const content = JSON.stringify([VEHICLE_DATA_VERSION, specs, images, media.map(object => [object.id, object.sha256, Number(object.size_bytes)])]);
  return createHash("sha256").update(content).digest("hex");
}

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

// Rows fetched per cursor batch while the export streams the job statuses and supplier item keys to jobs.ndjson / items.ndjson (#1357).
export const CURSOR_BATCH = 5000;

/**
 * Reads a query in batches from a server-side cursor on the caller's client. The cursor is not holdable, so it lives inside the export's
 * REPEATABLE READ READ ONLY transaction and sees its snapshot; the set is evaluated once and streamed, `sql` keeps its own ORDER BY.
 */
async function* cursorBatches(client: PoolClient, name: string, sql: string, params: unknown[], size: number) {
  // Plan the cursor for the whole result like the single query (the default 0.1 favours a fast start); SET LOCAL ends with the transaction.
  await client.query("SET LOCAL cursor_tuple_fraction = 1");
  await client.query(`DECLARE ${name} NO SCROLL CURSOR FOR ${sql}`, params);
  try {
    for (;;) {
      const { rows } = await client.query<Record<string, unknown>>(`FETCH ${size} FROM ${name}`);
      if (rows.length) yield rows;
      if (rows.length < size) return;
    }
  } finally {
    // After a server error the transaction is aborted and CLOSE fails too (25P02); the cursor dies with the transaction,
    // so a failed CLOSE must not replace the original error.
    await client.query(`CLOSE ${name}`).catch(() => {});
  }
}

/** The complete/partial job statuses of enriched products ordered by supplier_item_id (the primary key), one cursor batch at a time. */
export function exportedJobBatches(client: PoolClient, size = CURSOR_BATCH) {
  return cursorBatches(client, "export_jobs",
    `SELECT j.supplier_item_id,j.supplier_code,j.supplier_brand,j.oem,j.status,j.candidate_url,j.last_attempt_at
      FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id) WHERE j.status IN ('complete','partial') ORDER BY j.supplier_item_id`, [], size);
}

/** The supplier item keys the bundle references (exported enrichments, logo evidence, complete/partial jobs) ordered by id, one cursor batch at a time. `changed` is [watermark, retry JSON]. */
export function exportedItemBatches(client: PoolClient, changed: unknown[], size = CURSOR_BATCH) {
  return cursorBatches(client, "export_items",
    `SELECT id,supplier,company,list_group,warehouse,code FROM supplier_items WHERE id IN (
      ${EXPORTED_ENRICHMENT_IDS} UNION SELECT evidence_product_id FROM manufacturer_logos
      UNION SELECT j.supplier_item_id FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id) WHERE j.status IN ('complete','partial'))
      ORDER BY id`, changed, size);
}

/** Writes every job status in order; resolves to the row count. */
export async function streamJobs(client: PoolClient, write: (row: unknown) => Promise<void>, size = CURSOR_BATCH) {
  let count = 0;
  for await (const rows of exportedJobBatches(client, size)) for (const row of rows) { await write(row); count++; }
  return count;
}

/**
 * Writes the supplier item keys in id order, then the keys of the tombstones whose supplier item was not among them, in tombstone
 * order and once per id (the item may be gone here, so its key comes from the log); resolves to the row count.
 */
export async function streamItems(client: PoolClient, changed: unknown[], tombstones: Pick<Tombstone, "supplier_item_id" | "supplier" | "company" | "list_group" | "warehouse" | "code">[],
  write: (row: unknown) => Promise<void>, size = CURSOR_BATCH) {
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
