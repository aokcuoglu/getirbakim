import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";
import { sendWithSkewRetry } from "./storefront-media-read";
import { EXPORTED_ENRICHMENT_IDS } from "./storefront-bundle-export";
import type { BundleItem } from "./storefront-bundle-items";
import { bundleTombstones, DEFAULT_MAX_DELETIONS, exportTombstones, pruneTombstones, TOMBSTONE_RETENTION_DAYS } from "./storefront-bundle-tombstones";
import { parsePositiveInteger, parseRetryItems } from "./storefront-sync-state";

// Writes storefront data produced locally (Trodo category tree, labels, images, product
// mappings, product enrichments with their images, manufacturer logos, REPXPERT vehicle type specs and pictures) to a bundle that
// scripts/import-storefront-bundle.ts loads into another database. manifest.items carries the natural key of every
// supplier item the bundle references, so a product whose id differs there is still found (storefront-bundle-items.ts).
// Enrichment runs, request logs and caches stay local; vehicle fitments are rebuilt after import.
// --since=ISO exports only enrichments imported after that time (and their mappings and images); the
// category tree, logos, REPXPERT vehicle data and enrichment job statuses are always complete. manifest.snapshotAt is the next run's --since.
// --retry-file=<json> adds the enrichments of the supplier items listed there (the sync's retry list: items the target
// skipped last time) whatever their imported_at (storefront-bundle-export.ts).
// manifest.tombstones (#564, storefront-bundle-tombstones.ts) lists the enrichments deleted or invalidated here in the
// last TOMBSTONE_RETENTION_DAYS (the whole log without --since), whatever the watermark; their supplier item keys come
// from the log, so a deleted item is still found on the target. manifest.maxDeletions (--max-deletions=<n>, default
// DEFAULT_MAX_DELETIONS) caps the enrichments the import may delete. Invalidated jobs travel as a count
// (manifest.invalidatedJobs) while the target only reports them. --prune (the sync's real runs, not --dry-run) deletes
// log entries past the retention after the export.
//
// Where each enrichment table comes from on the target (#553):
// - carried: source categories, product enrichments + mappings + media, logos, vehicle_type_specs/images and
//   product_enrichment_jobs (complete/partial with an enrichment row, in full every run like vehicleSpecs):
//   product_enrichments has no status, the storefront reads it through enrichment_valid_data's
//   `JOIN product_enrichment_jobs ... status IN ('complete','partial')`, so without the jobs a new enrichment never
//   reaches product_enrichment_shared_links → storefront_enrichments there.
// - derived on AWS after import (import-storefront-inbound.ts): product_vehicle_fitments (rebuild-product-fitments.ts
//   --items: the products the bundle wrote plus rows of an older matcher version), product_enrichment_shared_links + storefront_make_fits / storefront_model_fits (shared-link queue drained),
//   enrichment_product_states (enrichment-states.ts sync). product_model_fitments is derived from the target's own
//   Dinamik supplier items (description-fitments.ts derive), not per sync.
// - shipped separately: vehicle_type_oil_specs (data/vehicle_type_oil_specs.csv + db:vehicle-oils); not shipped:
//   vehicle_type_trodo_oils, product_enrichment_sources, enrichment runs, request logs and caches.
const root = resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) || ".local/storefront-bundle");
const sinceArg = process.argv.find(arg => arg.startsWith("--since="))?.slice(8);
const since = sinceArg ? new Date(sinceArg) : null;
if (since && Number.isNaN(since.getTime())) throw new Error("--since must be an ISO timestamp");
const retryFile = process.argv.find(arg => arg.startsWith("--retry-file="))?.slice("--retry-file=".length);
const retry = retryFile ? parseRetryItems(await readFile(retryFile, "utf8")) : [];
const prune = process.argv.includes("--prune");
const maxDeletionsArg = process.argv.find(arg => arg.startsWith("--max-deletions="))?.slice("--max-deletions=".length);
const maxDeletions = maxDeletionsArg === undefined ? DEFAULT_MAX_DELETIONS : parsePositiveInteger(maxDeletionsArg, "--max-deletions");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = objectStorage();
const client = await pool.connect();
try {
  // One snapshot so mappings, enrichments and media agree while a local worker keeps writing.
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const read = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  const changed = [since ?? new Date(0), JSON.stringify(retry)];
  const { tombstones, invalidatedJobs } = bundleTombstones(await exportTombstones(client, since === null));
  const items: BundleItem[] = await read(`SELECT id,supplier,company,list_group,warehouse,code FROM supplier_items WHERE id IN (
      ${EXPORTED_ENRICHMENT_IDS} UNION SELECT evidence_product_id FROM manufacturer_logos
      UNION SELECT j.supplier_item_id FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id) WHERE j.status IN ('complete','partial'))
      ORDER BY id`, changed);
  // A tombstone's supplier item may be gone here; its key comes from the log.
  const listed = new Set(items.map(item => item.id));
  for (const { supplier_item_id: id, supplier, company, list_group, warehouse, code } of tombstones) {
    if (!listed.has(id)) items.push({ id, supplier, company, list_group, warehouse, code });
    listed.add(id);
  }
  const manifest = {
    exportedAt: new Date().toISOString(),
    since: since?.toISOString() ?? null,
    retried: retry.length,
    snapshotAt: (await read("SELECT now() AS at"))[0].at,
    categories: await read("SELECT * FROM source_categories ORDER BY source,category_id"),
    labels: await read("SELECT * FROM source_category_labels ORDER BY source,category_id,locale"),
    images: await read("SELECT * FROM source_category_images ORDER BY source,category_id"),
    products: await read(`SELECT * FROM product_source_categories WHERE supplier_item_id IN (${EXPORTED_ENRICHMENT_IDS})
      ORDER BY supplier_item_id,source,category_id`, changed),
    enrichments: await read(`SELECT * FROM product_enrichments WHERE supplier_item_id IN (${EXPORTED_ENRICHMENT_IDS}) ORDER BY supplier_item_id`, changed),
    // Hex bytea text survives JSON; the driver's Buffer would not.
    logos: await read(`SELECT brand_key,manufacturer,'\\x'||encode(image_data,'hex') AS image_data,sha256,width,height,source_url,evidence_product_id,evidence_source_url,imported_at
      FROM manufacturer_logos ORDER BY brand_key`),
    // REPXPERT vehicle data goes whole every time (like logos): a production still running code that ignores it
    // must receive it again once it is updated, whatever the watermark says. The raw response stays local.
    vehicleSpecs: await read(`SELECT vehicle_type_id,outcome,detail,full_name,body_type,drive_type,engine_type,fuel_mixture,cylinders,valves,engine_codes,kba_numbers,fetched_at
      FROM vehicle_type_specs WHERE outcome<>'error' ORDER BY vehicle_type_id`),
    vehicleImages: await read("SELECT * FROM vehicle_type_images ORDER BY vehicle_type_id"),
    media: await read(`SELECT * FROM product_media_objects WHERE id IN (SELECT media_id FROM source_category_images UNION SELECT image_id FROM product_enrichments WHERE supplier_item_id IN (${EXPORTED_ENRICHMENT_IDS})
      UNION SELECT media_id FROM vehicle_type_images) ORDER BY id`, changed),
    jobs: await read(`SELECT j.supplier_item_id,j.supplier_code,j.supplier_brand,j.oem,j.status,j.candidate_url,j.last_attempt_at
      FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id) WHERE j.status IN ('complete','partial') ORDER BY j.supplier_item_id`),
    tombstones,
    invalidatedJobs,
    maxDeletions,
    items,
  };
  await client.query("COMMIT");
  const pruned = prune ? await pruneTombstones(client) : 0;
  for (const object of manifest.media) {
    const path = resolve(root, "media", object.object_key);
    if (!path.startsWith(resolve(root, "media") + sep)) throw new Error("Unsafe media key");
    const result = await sendWithSkewRetry(() => storage.send(new GetObjectCommand({ Bucket: object.bucket, Key: object.object_key })),
      { onRetry: (attempt, delayMs) => console.warn(`MinIO clock skew reading ${object.object_key}; retry ${attempt} in ${delayMs / 1000}s`) });
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes || bytes.length !== object.size_bytes || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error(`Media integrity failed: ${object.object_key}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest));
  console.log(`Exported ${manifest.categories.length} categories, ${manifest.labels.length} labels, ${manifest.images.length} category images, ${manifest.products.length} product mappings, ${manifest.enrichments.length} enrichments, ${manifest.jobs.length} enrichment jobs, ${manifest.logos.length} logos, ${manifest.vehicleSpecs.length} vehicle specs, ${manifest.vehicleImages.length} vehicle images, ${manifest.media.length} media objects, ${tombstones.length} tombstones, ${invalidatedJobs} invalidated jobs (max ${maxDeletions} deletions, ${pruned} log entries older than ${TOMBSTONE_RETENTION_DAYS} days pruned)${retry.length ? ` (${retry.length} retried supplier items)` : ""} to ${root}`);
} finally { client.release(); storage.destroy(); await pool.end(); }
