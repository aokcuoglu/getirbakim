import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";
import { requireEnrichmentSchema } from "../src/modules/enrichment/schema";
import { bundleItems, resolveBundleItems } from "./storefront-bundle-items";
import { importBundleEnrichments } from "./storefront-bundle-enrichments";
import { importBundleJobs } from "./storefront-bundle-jobs";
import { bundleSources, replaceBundleMappings } from "./storefront-bundle-mappings";
import { ensureStoredObjects, type MediaTarget, mediaToRecheck, resolveMediaTargets } from "./storefront-bundle-media";
import { applyBundleTombstones, DEFAULT_MAX_DELETIONS, pruneTombstones } from "./storefront-bundle-tombstones";

// Loads a bundle from scripts/export-storefront-bundle.ts. Dry run by default; --apply writes.
// Idempotent: rows are upserted (the bundle is the source of truth for these tables), media is
// matched by sha256, supplier items are matched by their natural key (then by id; see storefront-bundle-items.ts),
// and rows whose supplier item does not exist here are skipped and counted.
// With --apply the media objects are stored before the transaction, so S3 round trips hold no row locks (#1406): an object
// whose size and sha256 metadata match costs one HEAD, any other is written and read back (storefront-bundle-media.ts,
// STOREFRONT_MEDIA_CONCURRENCY at a time). A failure there leaves nothing written. Inside the transaction only the rows it
// resolved differently from that read are stored again (normally none). report.mediaUploaded / mediaVerified count them.
// manifest.jobs (complete/partial enrichment job statuses) is upserted only where it changes (storefront-bundle-jobs.ts);
// jobs a part does not carry are left alone, as the split sends them in the job parts that follow part-00 (#1317).
// The bundle's category mappings replace those of its enrichments' products (storefront-bundle-mappings.ts).
// manifest.tombstones (#564, part-00 only) deletes the enrichments deleted at the source, before anything is written;
// more than manifest.maxDeletions deletions stop the import, in a dry run too (storefront-bundle-tombstones.ts).
// With --apply, log entries past the retention are pruned here as well (this database logs its own deletions).
// --report=<path> (with --apply) writes the counts, the supplier items whose enrichments were skipped, so the
// sync can send them again (import-storefront-inbound.ts → report.json → the sync's retry list), and the local supplier
// items whose enrichments it wrote (items).
// Run scripts/rebuild-product-fitments.ts afterwards to derive vehicle fitments: with --items=<file of those items>
// (import-storefront-inbound.ts does) or without arguments for every product.
const root = resolve(process.argv[2] || "/bundle");
const apply = process.argv.includes("--apply");
const reportPath = process.argv.find(arg => arg.startsWith("--report="))?.slice("--report=".length);
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error("S3_BUCKET required");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
// An export directory keeps its enrichments outside manifest.json (#1316); only the parts split-storefront-bundle.ts writes are bundles.
if (manifest.enrichmentsFile) throw new Error("Unsplit export (enrichments are in enrichments.ndjson): import its parts");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = objectStorage();
const client = await pool.connect();
try {
  const files = new Map<string, Uint8Array>();
  for (const object of manifest.media) {
    const path = resolve(root, "media", object.object_key);
    if (!path.startsWith(resolve(root, "media") + sep)) throw new Error("Unsafe media key");
    const bytes = await readFile(path);
    if (bytes.length !== object.size_bytes || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error(`Bundle media integrity failed: ${object.object_key}`);
    files.set(object.sha256, bytes);
  }
  // The schema comes from db:setup (db/source-categories.sql, db/vehicle-type-specs.sql); DDL here would queue readers behind a table lock (#934).
  await requireEnrichmentSchema(client, ["source_categories", "source_category_labels", "source_category_images", "product_source_categories", "vehicle_type_specs", "vehicle_type_images"]);
  const json = (value: unknown) => JSON.stringify(value);
  // Each large array is serialised once and the string reused by every query below.
  const mediaJson = json(manifest.media);
  const bytesOf = (sha256: string) => files.get(sha256)!;
  // A plain read, then the objects: a dry run plans nothing and sends nothing to S3.
  const mediaStarted = performance.now();
  const planned = apply ? await resolveMediaTargets(client, mediaJson, bucket) : [];
  const ensured = await ensureStoredObjects(storage, planned, bytesOf);
  const mediaMs = Math.round(performance.now() - mediaStarted);
  await client.query("BEGIN");
  const transactionStarted = performance.now();
  // Bundles written before REPXPERT carried Wikidata series photographs under vehicleImages; those are ignored.
  const vehicleSpecs: unknown[] = manifest.vehicleSpecs ?? [];
  const vehicleImages: unknown[] = manifest.vehicleSpecs ? manifest.vehicleImages ?? [] : [];
  const logosJson = json(manifest.logos);
  const enrichmentsJson = json(manifest.enrichments);
  const vehicleSpecsJson = json(vehicleSpecs);
  const vehicleImagesJson = json(vehicleImages);
  const count = async (sql: string, ...params: unknown[]) => Number((await client.query(sql, params)).rows[0].count);
  const run = async (sql: string, ...params: unknown[]) => (await client.query(sql, params)).rowCount ?? 0;
  const keys = bundleItems(manifest);
  const items = await resolveBundleItems(client, keys);
  // bi.id is the local supplier item a bundle row belongs to; null when it does not exist here.
  const missingItem = "NOT EXISTS (SELECT 1 FROM bundle_items bi WHERE bi.bundle_id=r.supplier_item_id AND bi.id IS NOT NULL)";
  const vehicleTypeExists = "EXISTS (SELECT 1 FROM vehicle_types t WHERE t.id=r.vehicle_type_id)";

  // Media rows keep their sha256 identity; an existing object with the same content is reused. RETURNING names the rows
  // this transaction inserted, which the media recheck below compares with the read before it.
  const inserted = new Set((await client.query<{ sha256: string }>(`INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url,created_at)
    SELECT id,$2,object_key,sha256,content_type,size_bytes,source_url,created_at FROM jsonb_populate_recordset(null::product_media_objects,$1::jsonb)
    ON CONFLICT DO NOTHING RETURNING sha256`, [mediaJson, bucket])).rows.map(row => row.sha256));
  await client.query(`CREATE TEMP TABLE bundle_media ON COMMIT DROP AS SELECT b.id AS bundle_id,m.id FROM jsonb_populate_recordset(null::product_media_objects,$1::jsonb) b
    JOIN product_media_objects m ON m.sha256=b.sha256`, [mediaJson]);
  if (await count("SELECT count(*) FROM bundle_media") !== manifest.media.length) throw new Error("Media rows could not be resolved by sha256");

  // Bundles written before #564 carry no tombstones. Applied before the jobs and enrichments: the export leaves out
  // items enriched again, and a deletion must never undo a row this bundle writes.
  const tombstones = await applyBundleTombstones(client, manifest.tombstones ?? [], bundleSources(manifest),
    { maxDeletions: manifest.maxDeletions ?? DEFAULT_MAX_DELETIONS });
  // Bundles written before job statuses were carried have none; their jobs are left as they are.
  const jobs = await importBundleJobs(client, manifest.jobs ?? []);
  // Unconditional on purpose (see storefront-bundle-enrichments.ts): enriched.items, the local supplier items whose
  // enrichments this bundle wrote, scope the fitment rebuild (--items of rebuild-product-fitments.ts).
  const enriched = await importBundleEnrichments(client, manifest.enrichments, enrichmentsJson);
  const written = {
    categories: await run(`INSERT INTO source_categories SELECT * FROM jsonb_populate_recordset(null::source_categories,$1::jsonb)
      ON CONFLICT (source,category_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,name=EXCLUDED.name,slug=EXCLUDED.slug,path_ids=EXCLUDED.path_ids,
      source_url=EXCLUDED.source_url,raw=EXCLUDED.raw,fetched_at=EXCLUDED.fetched_at`, json(manifest.categories)),
    labels: await run(`INSERT INTO source_category_labels SELECT * FROM jsonb_populate_recordset(null::source_category_labels,$1::jsonb)
      ON CONFLICT (source,category_id,locale) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug`, json(manifest.labels)),
    categoryImages: await run(`INSERT INTO source_category_images(source,category_id,media_id,width,height)
      SELECT r.source,r.category_id,bm.id,r.width,r.height FROM jsonb_populate_recordset(null::source_category_images,$1::jsonb) r JOIN bundle_media bm ON bm.bundle_id=r.media_id
      ON CONFLICT (source,category_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height`, json(manifest.images)),
    enrichments: enriched.written,
  };
  // After the category tree (the mappings reference it) and the enrichments they belong to.
  const mappings = await replaceBundleMappings(client, manifest, enrichmentsJson);
  const report = {
    ...written,
    productMappings: mappings.inserted,
    removedMappings: mappings.removed,
    logos: await run(`INSERT INTO manufacturer_logos(brand_key,manufacturer,image_data,sha256,width,height,source_url,evidence_product_id,evidence_source_url,imported_at)
      SELECT r.brand_key,r.manufacturer,r.image_data,r.sha256,r.width,r.height,r.source_url,
      bi.id,r.evidence_source_url,r.imported_at
      FROM jsonb_populate_recordset(null::manufacturer_logos,$1::jsonb) r LEFT JOIN bundle_items bi ON bi.bundle_id=r.evidence_product_id
      ON CONFLICT (brand_key) DO UPDATE SET manufacturer=EXCLUDED.manufacturer,image_data=EXCLUDED.image_data,sha256=EXCLUDED.sha256,width=EXCLUDED.width,
      height=EXCLUDED.height,source_url=EXCLUDED.source_url,evidence_product_id=EXCLUDED.evidence_product_id,evidence_source_url=EXCLUDED.evidence_source_url,imported_at=EXCLUDED.imported_at`, logosJson),
    // A vehicle type missing here (older vehicle import) is skipped and counted.
    vehicleSpecs: await run(`INSERT INTO vehicle_type_specs(vehicle_type_id,outcome,detail,full_name,body_type,drive_type,engine_type,fuel_mixture,cylinders,valves,engine_codes,kba_numbers,fetched_at)
      SELECT r.vehicle_type_id,r.outcome,r.detail,r.full_name,r.body_type,r.drive_type,r.engine_type,r.fuel_mixture,r.cylinders,r.valves,r.engine_codes,r.kba_numbers,r.fetched_at
      FROM jsonb_populate_recordset(null::vehicle_type_specs,$1::jsonb) r WHERE ${vehicleTypeExists}
      ON CONFLICT (vehicle_type_id) DO UPDATE SET outcome=EXCLUDED.outcome,detail=EXCLUDED.detail,full_name=EXCLUDED.full_name,body_type=EXCLUDED.body_type,
      drive_type=EXCLUDED.drive_type,engine_type=EXCLUDED.engine_type,fuel_mixture=EXCLUDED.fuel_mixture,cylinders=EXCLUDED.cylinders,valves=EXCLUDED.valves,
      engine_codes=EXCLUDED.engine_codes,kba_numbers=EXCLUDED.kba_numbers,fetched_at=EXCLUDED.fetched_at`, vehicleSpecsJson),
    vehicleImages: await run(`INSERT INTO vehicle_type_images(vehicle_type_id,media_id,width,height,imported_at)
      SELECT r.vehicle_type_id,bm.id,r.width,r.height,r.imported_at FROM jsonb_populate_recordset(null::vehicle_type_images,$1::jsonb) r
      JOIN bundle_media bm ON bm.bundle_id=r.media_id WHERE ${vehicleTypeExists}
      ON CONFLICT (vehicle_type_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height,imported_at=EXCLUDED.imported_at`, vehicleImagesJson),
    skippedVehicleSpecs: await count(`SELECT count(*) FROM jsonb_populate_recordset(null::vehicle_type_specs,$1::jsonb) r WHERE NOT ${vehicleTypeExists}`, vehicleSpecsJson),
    skippedVehicleImages: await count(`SELECT count(*) FROM jsonb_populate_recordset(null::vehicle_type_images,$1::jsonb) r WHERE NOT ${vehicleTypeExists}`, vehicleImagesJson),
    jobs: jobs.jobs,
    skippedJobs: jobs.skipped,
    media: manifest.media.length,
    // Objects written and read back, and objects whose HEAD matched (#1406); both 0 in a dry run.
    mediaUploaded: ensured.uploaded,
    mediaVerified: ensured.verified,
    skippedEnrichments: await count(`SELECT count(*) FROM jsonb_populate_recordset(null::product_enrichments,$1::jsonb) r WHERE ${missingItem}`, enrichmentsJson),
    skippedMappings: await count(`SELECT count(*) FROM jsonb_populate_recordset(null::product_source_categories,$1::jsonb) r WHERE ${missingItem}`, json(manifest.products)),
    // Products found here by supplier key under a different id (listed after the cutover on each side separately).
    itemsByKey: items.rekeyed,
    // Always present (0 without tombstones): the sync tells an image older than #564 by its absence.
    tombstones: tombstones.tombstones,
    removedEnrichments: tombstones.removedEnrichments,
    removedEnrichmentMappings: tombstones.removedMappings,
    resetJobs: tombstones.resetJobs,
    // Shipped as a count (manifest.invalidatedJobs, part-00) while this side only reports them.
    invalidatedJobsReported: tombstones.invalidatedJobsReported + (manifest.invalidatedJobs ?? 0),
    tombstonesKept: tombstones.tombstonesKept,
  };
  if (report.categoryImages !== manifest.images.length) throw new Error(`Category image rows mismatch: ${report.categoryImages}/${manifest.images.length}`);
  const logoMismatch = await count(`SELECT count(*) FROM jsonb_populate_recordset(null::manufacturer_logos,$1::jsonb) r JOIN manufacturer_logos l USING(brand_key)
    WHERE encode(sha256(l.image_data),'hex')<>r.sha256`, logosJson);
  if (logoMismatch) throw new Error(`Logo bytes differ from their sha256: ${logoMismatch}`);
  if (!apply) {
    await client.query("ROLLBACK");
    console.log("DRY RUN (nothing written)", report);
  } else {
    const skippedIds = (await client.query<{ id: string }>(`SELECT DISTINCT r.supplier_item_id AS id
      FROM jsonb_populate_recordset(null::product_enrichments,$1::jsonb) r WHERE ${missingItem}`, [enrichmentsJson])).rows.map(row => row.id);
    const targets = (await client.query<MediaTarget>(
      "SELECT m.bucket,m.object_key,m.sha256,m.content_type FROM bundle_media bm JOIN product_media_objects m ON m.id=bm.id")).rows;
    // No row commits unless its object was stored in this run: the ones resolved otherwise than before BEGIN are stored now.
    const late = await ensureStoredObjects(storage, mediaToRecheck(planned, targets, inserted), bytesOf);
    report.mediaUploaded += late.uploaded;
    report.mediaVerified += late.verified;
    await pruneTombstones(client);
    await client.query("COMMIT");
    console.log("APPLIED", report, { mediaMs, transactionMs: Math.round(performance.now() - transactionStarted) });
    if (reportPath) {
      const byId = new Map(keys.map(item => [item.id, item]));
      await writeFile(reportPath, JSON.stringify({ report, skipped: skippedIds.map(id => byId.get(id) ?? { id }), items: enriched.items }));
    }
  }
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally { client.release(); storage.destroy(); await pool.end(); }
