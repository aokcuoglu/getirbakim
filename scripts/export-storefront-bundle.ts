import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";
import { sendWithSkewRetry } from "./storefront-media-read";
import { EXPORTED_ENRICHMENT_IDS, exportedEnrichmentBatches, exportedEnrichmentIds, streamItems, streamJobs, vehicleDataDigest } from "./storefront-bundle-export";
import { ENRICHMENTS_FILE, ITEMS_FILE, JOBS_FILE, MEDIA_FILE, ndjsonWriter, PRODUCTS_FILE, writeNdjson } from "./storefront-bundle-stream";
import { bundleTombstones, DEFAULT_MAX_DELETIONS, exportTombstones, pruneTombstones, TOMBSTONE_RETENTION_DAYS } from "./storefront-bundle-tombstones";
import { parsePositiveInteger, parseRetryItems, parseVehicleDigest } from "./storefront-sync-state";

// Writes storefront data produced locally (Trodo category tree, labels, images, product
// mappings, product enrichments with their images, manufacturer logos, REPXPERT vehicle type specs and pictures) to a bundle that
// scripts/import-storefront-bundle.ts loads into another database. The supplier item keys carry the natural key of every
// supplier item the bundle references, so a product whose id differs there is still found (storefront-bundle-items.ts).
// Layout (#1316, #1317): every row set that grows with the enriched products goes to its own NDJSON file
// (storefront-bundle-stream.ts), never one string: enrichments.ndjson (read in batches inside the snapshot and streamed;
// a 43k-enrichment delta passed V8's ~512 MiB string limit on 2026-11-23), jobs.ndjson (every complete/partial job
// status), items.ndjson (the supplier item keys), products.ndjson (category mappings) and media.ndjson (media rows).
// <root>/manifest.json keeps the rest, which does not grow with the enriched products (category tree, logos, REPXPERT
// vehicle data and its digest, the tombstones of the retention window, counts) and, for each file, its name and row count
// (enrichmentsFile/enrichmentCount, jobsFile/jobCount, itemsFile/itemCount, productsFile/productCount,
// mediaFile/mediaCount). Media files go to <root>/media/<object_key>. An old manifest.json is removed first and the new
// one written last, so an aborted export, even into a reused directory, leaves none.
// scripts/split-storefront-bundle.ts turns this into the part-NN/ bundles the importer reads; it is never imported whole.
// Enrichment runs, request logs and caches stay local; vehicle fitments are rebuilt after import.
// --since=ISO exports only enrichments imported after that time (and their mappings and images); the
// category tree, logos and enrichment job statuses are always complete. manifest.snapshotAt is the next run's --since.
// REPXPERT vehicle data (#1359) is complete too unless --vehicle-digest=<sha256 hex> (the sync passes the digest the
// target last confirmed) equals the digest of the data in this snapshot (storefront-bundle-export.ts vehicleDataDigest):
// then vehicleSpecs and vehicleImages are [] and their media stay out. manifest.vehicleData records { digest, specs,
// images, sent } either way; the split keeps it out of the parts. Without the flag (a manual export) it is always sent.
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
// - carried: source categories, product enrichments + mappings + media, logos, vehicle_type_specs/images (unless unchanged, above) and
//   product_enrichment_jobs (complete/partial with an enrichment row, in full every run like the logos):
//   product_enrichments has no status, the storefront reads it through enrichment_valid_data's
//   `JOIN product_enrichment_jobs ... status IN ('complete','partial')`, so without the jobs a new enrichment never
//   reaches product_enrichment_shared_links → storefront_enrichments there.
// - derived on AWS after import (import-storefront-inbound.ts): product_vehicle_fitments (rebuild-product-fitments.ts
//   --items: the products the bundle wrote plus rows of an older matcher version), product_enrichment_shared_links + storefront_make_fits / storefront_model_fits / storefront_make_description_fits / storefront_facet_specs (shared-link queue drained),
//   enrichment_product_states (enrichment-states.ts sync). product_model_fitments is derived from the target's own
//   Dinamik supplier items (description-fitments.ts derive), not per sync.
// - shipped separately: vehicle_type_oil_specs (data/vehicle_type_oil_specs.csv + db:vehicle-oils); not shipped:
//   vehicle_type_trodo_oils, product_enrichment_sources, enrichment runs, request logs and caches.
/** Streams rows to a new NDJSON file through `fill`; resolves to the number of rows written. */
async function writeToFile(path: string, fill: (write: (row: unknown) => Promise<void>) => Promise<number>) {
  const writer = ndjsonWriter(path);
  try {
    return await fill(async row => { await writer.write(row); });
  } finally { await writer.close(); }
}
const root = resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) || ".local/storefront-bundle");
const sinceArg = process.argv.find(arg => arg.startsWith("--since="))?.slice(8);
const since = sinceArg ? new Date(sinceArg) : null;
if (since && Number.isNaN(since.getTime())) throw new Error("--since must be an ISO timestamp");
const retryFile = process.argv.find(arg => arg.startsWith("--retry-file="))?.slice("--retry-file=".length);
const retry = retryFile ? parseRetryItems(await readFile(retryFile, "utf8")) : [];
const prune = process.argv.includes("--prune");
const maxDeletionsArg = process.argv.find(arg => arg.startsWith("--max-deletions="))?.slice("--max-deletions=".length);
const maxDeletions = maxDeletionsArg === undefined ? DEFAULT_MAX_DELETIONS : parsePositiveInteger(maxDeletionsArg, "--max-deletions");
const vehicleDigestArg = process.argv.find(arg => arg.startsWith("--vehicle-digest="))?.slice("--vehicle-digest=".length);
const confirmedVehicleDigest = vehicleDigestArg === undefined ? null : parseVehicleDigest(vehicleDigestArg, "--vehicle-digest");
await mkdir(root, { recursive: true });
// A manual export into a reused directory must not leave an old manifest naming the side files it rewrites.
await rm(resolve(root, "manifest.json"), { force: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = objectStorage();
const client = await pool.connect();
try {
  // One snapshot so mappings, enrichments and media agree while a local worker keeps writing.
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const read = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  const changed = [since ?? new Date(0), JSON.stringify(retry)];
  const { tombstones, invalidatedJobs } = bundleTombstones(await exportTombstones(client, since === null));
  const ids = await exportedEnrichmentIds(client, changed);
  const enrichments = ndjsonWriter(resolve(root, ENRICHMENTS_FILE));
  let written = 0;
  for await (const rows of exportedEnrichmentBatches(client, ids)) {
    for (const row of rows) {
      await enrichments.write(row);
      written++;
    }
  }
  await enrichments.close();
  if (written !== ids.length) throw new Error(`Wrote ${written} of ${ids.length} enrichments`);
  // Job statuses and supplier item keys stream from server-side cursors inside this snapshot (#1357): their memory is bounded by the batch (ids, products and media stay delta-bounded).
  const jobCount = await writeToFile(resolve(root, JOBS_FILE), write => streamJobs(client, write));
  const itemCount = await writeToFile(resolve(root, ITEMS_FILE), write => streamItems(client, changed, tombstones, write));
  // REPXPERT vehicle data, read whole in this snapshot to digest it (#1359). It goes only when the digest differs from the
  // one the target last confirmed (--vehicle-digest), or always without that flag: a production that has not applied it
  // yet, a restored target or a release that ignored it gets it again. The raw response stays local.
  const vehicleSpecs = await read(`SELECT vehicle_type_id,outcome,detail,full_name,body_type,drive_type,engine_type,fuel_mixture,cylinders,valves,engine_codes,kba_numbers,fetched_at
    FROM vehicle_type_specs WHERE outcome<>'error' ORDER BY vehicle_type_id`);
  const vehicleImages = await read("SELECT * FROM vehicle_type_images ORDER BY vehicle_type_id");
  const vehicleMedia = (await client.query<{ id: string; sha256: string; size_bytes: number }>(
    "SELECT id,sha256,size_bytes FROM product_media_objects WHERE id IN (SELECT media_id FROM vehicle_type_images) ORDER BY id")).rows;
  const vehicleDigest = vehicleDataDigest(vehicleSpecs, vehicleImages, vehicleMedia);
  const sendVehicle = vehicleDigest !== confirmedVehicleDigest;
  // Kept for the media download below; the manifest names the file and the count only. Vehicle images only with the data.
  const media = await read(`SELECT * FROM product_media_objects WHERE id IN (SELECT media_id FROM source_category_images UNION SELECT image_id FROM product_enrichments WHERE supplier_item_id IN (${EXPORTED_ENRICHMENT_IDS})
    UNION SELECT media_id FROM vehicle_type_images WHERE $3::boolean) ORDER BY id`, [...changed, sendVehicle]);
  const manifest = {
    exportedAt: new Date().toISOString(),
    since: since?.toISOString() ?? null,
    retried: retry.length,
    snapshotAt: (await read("SELECT now() AS at"))[0].at,
    categories: await read("SELECT * FROM source_categories ORDER BY source,category_id"),
    labels: await read("SELECT * FROM source_category_labels ORDER BY source,category_id,locale"),
    images: await read("SELECT * FROM source_category_images ORDER BY source,category_id"),
    productsFile: PRODUCTS_FILE,
    productCount: await writeNdjson(resolve(root, PRODUCTS_FILE), await read(`SELECT * FROM product_source_categories WHERE supplier_item_id IN (${EXPORTED_ENRICHMENT_IDS})
      ORDER BY supplier_item_id,source,category_id`, changed)),
    enrichmentsFile: ENRICHMENTS_FILE,
    enrichmentCount: ids.length,
    // Hex bytea text survives JSON; the driver's Buffer would not.
    logos: await read(`SELECT brand_key,manufacturer,'\\x'||encode(image_data,'hex') AS image_data,sha256,width,height,source_url,evidence_product_id,evidence_source_url,imported_at
      FROM manufacturer_logos ORDER BY brand_key`),
    // Whole or empty, never a delta: the importer upserts what a part carries and deletes nothing that is missing.
    vehicleSpecs: sendVehicle ? vehicleSpecs : [],
    vehicleImages: sendVehicle ? vehicleImages : [],
    vehicleData: { digest: vehicleDigest, specs: vehicleSpecs.length, images: vehicleImages.length, sent: sendVehicle },
    mediaFile: MEDIA_FILE,
    mediaCount: await writeNdjson(resolve(root, MEDIA_FILE), media),
    jobsFile: JOBS_FILE,
    jobCount,
    tombstones,
    invalidatedJobs,
    maxDeletions,
    itemsFile: ITEMS_FILE,
    itemCount,
  };
  await client.query("COMMIT");
  const pruned = prune ? await pruneTombstones(client) : 0;
  for (const object of media) {
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
  console.log(`Exported ${manifest.categories.length} categories, ${manifest.labels.length} labels, ${manifest.images.length} category images, ${manifest.productCount} product mappings, ${manifest.enrichmentCount} enrichments, ${manifest.jobCount} enrichment jobs, ${manifest.logos.length} logos, ${sendVehicle ? `${vehicleSpecs.length} vehicle specs, ${vehicleImages.length} vehicle images` : `vehicle data unchanged, omitted (${vehicleSpecs.length} specs, ${vehicleImages.length} images)`}, ${manifest.mediaCount} media objects, ${manifest.itemCount} supplier item keys, ${tombstones.length} tombstones, ${invalidatedJobs} invalidated jobs (max ${maxDeletions} deletions, ${pruned} log entries older than ${TOMBSTONE_RETENTION_DAYS} days pruned)${retry.length ? ` (${retry.length} retried supplier items)` : ""} to ${root}`);
} finally { client.release(); storage.destroy(); await pool.end(); }
