import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";

// Loads a bundle from scripts/export-storefront-bundle.ts. Dry run by default; --apply writes.
// Idempotent: rows are upserted (the bundle is the source of truth for these tables), media is
// matched by sha256, and rows whose supplier item does not exist here are skipped and counted.
// Run scripts/rebuild-product-fitments.ts afterwards to derive vehicle fitments.
const root = resolve(process.argv[2] || "/bundle");
const apply = process.argv.includes("--apply");
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error("S3_BUCKET required");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
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
  await client.query("BEGIN");
  await client.query(await readFile("db/source-categories.sql", "utf8"));
  const json = (value: unknown) => JSON.stringify(value);
  const count = async (sql: string, ...params: unknown[]) => Number((await client.query(sql, params)).rows[0].count);
  const run = async (sql: string, ...params: unknown[]) => (await client.query(sql, params)).rowCount ?? 0;
  const supplierItemExists = "EXISTS (SELECT 1 FROM supplier_items s WHERE s.id=r.supplier_item_id)";

  // Media rows keep their sha256 identity; an existing object with the same content is reused.
  await run(`INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url,created_at)
    SELECT id,$2,object_key,sha256,content_type,size_bytes,source_url,created_at FROM jsonb_populate_recordset(null::product_media_objects,$1::jsonb)
    ON CONFLICT DO NOTHING`, json(manifest.media), bucket);
  await client.query(`CREATE TEMP TABLE bundle_media ON COMMIT DROP AS SELECT b.id AS bundle_id,m.id FROM jsonb_populate_recordset(null::product_media_objects,$1::jsonb) b
    JOIN product_media_objects m ON m.sha256=b.sha256`, [json(manifest.media)]);
  if (await count("SELECT count(*) FROM bundle_media") !== manifest.media.length) throw new Error("Media rows could not be resolved by sha256");

  const report = {
    categories: await run(`INSERT INTO source_categories SELECT * FROM jsonb_populate_recordset(null::source_categories,$1::jsonb)
      ON CONFLICT (source,category_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,name=EXCLUDED.name,slug=EXCLUDED.slug,path_ids=EXCLUDED.path_ids,
      source_url=EXCLUDED.source_url,raw=EXCLUDED.raw,fetched_at=EXCLUDED.fetched_at`, json(manifest.categories)),
    labels: await run(`INSERT INTO source_category_labels SELECT * FROM jsonb_populate_recordset(null::source_category_labels,$1::jsonb)
      ON CONFLICT (source,category_id,locale) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug`, json(manifest.labels)),
    categoryImages: await run(`INSERT INTO source_category_images(source,category_id,media_id,width,height)
      SELECT r.source,r.category_id,bm.id,r.width,r.height FROM jsonb_populate_recordset(null::source_category_images,$1::jsonb) r JOIN bundle_media bm ON bm.bundle_id=r.media_id
      ON CONFLICT (source,category_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height`, json(manifest.images)),
    enrichments: await run(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload,imported_at,match_basis)
      SELECT r.supplier_item_id,r.supplier_code,r.supplier_brand,r.source_url,r.source_method,r.manufacturer,r.manufacturer_part_number,bm.id,r.payload,r.imported_at,r.match_basis
      FROM jsonb_populate_recordset(null::product_enrichments,$1::jsonb) r LEFT JOIN bundle_media bm ON bm.bundle_id=r.image_id WHERE ${supplierItemExists}
      ON CONFLICT (supplier_item_id) DO UPDATE SET supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,source_url=EXCLUDED.source_url,
      source_method=EXCLUDED.source_method,manufacturer=EXCLUDED.manufacturer,manufacturer_part_number=EXCLUDED.manufacturer_part_number,image_id=EXCLUDED.image_id,
      payload=EXCLUDED.payload,imported_at=EXCLUDED.imported_at,match_basis=EXCLUDED.match_basis`, json(manifest.enrichments)),
    productMappings: await run(`INSERT INTO product_source_categories SELECT r.* FROM jsonb_populate_recordset(null::product_source_categories,$1::jsonb) r
      WHERE ${supplierItemExists} ON CONFLICT DO NOTHING`, json(manifest.products)),
    logos: await run(`INSERT INTO manufacturer_logos(brand_key,manufacturer,image_data,sha256,width,height,source_url,evidence_product_id,evidence_source_url,imported_at)
      SELECT r.brand_key,r.manufacturer,r.image_data,r.sha256,r.width,r.height,r.source_url,
      CASE WHEN EXISTS (SELECT 1 FROM supplier_items s WHERE s.id=r.evidence_product_id) THEN r.evidence_product_id END,r.evidence_source_url,r.imported_at
      FROM jsonb_populate_recordset(null::manufacturer_logos,$1::jsonb) r
      ON CONFLICT (brand_key) DO UPDATE SET manufacturer=EXCLUDED.manufacturer,image_data=EXCLUDED.image_data,sha256=EXCLUDED.sha256,width=EXCLUDED.width,
      height=EXCLUDED.height,source_url=EXCLUDED.source_url,evidence_product_id=EXCLUDED.evidence_product_id,evidence_source_url=EXCLUDED.evidence_source_url,imported_at=EXCLUDED.imported_at`, json(manifest.logos)),
    media: manifest.media.length,
    skippedEnrichments: await count(`SELECT count(*) FROM jsonb_populate_recordset(null::product_enrichments,$1::jsonb) r WHERE NOT ${supplierItemExists}`, json(manifest.enrichments)),
    skippedMappings: await count(`SELECT count(*) FROM jsonb_populate_recordset(null::product_source_categories,$1::jsonb) r WHERE NOT ${supplierItemExists}`, json(manifest.products)),
  };
  if (report.categoryImages !== manifest.images.length) throw new Error(`Category image rows mismatch: ${report.categoryImages}/${manifest.images.length}`);
  const logoMismatch = await count(`SELECT count(*) FROM jsonb_populate_recordset(null::manufacturer_logos,$1::jsonb) r JOIN manufacturer_logos l USING(brand_key)
    WHERE encode(sha256(l.image_data),'hex')<>r.sha256`, json(manifest.logos));
  if (logoMismatch) throw new Error(`Logo bytes differ from their sha256: ${logoMismatch}`);
  if (!apply) {
    await client.query("ROLLBACK");
    console.log("DRY RUN (nothing written)", report);
  } else {
    const targets = (await client.query<{ bucket: string; object_key: string; sha256: string; content_type: string }>(
      "SELECT m.bucket,m.object_key,m.sha256,m.content_type FROM bundle_media bm JOIN product_media_objects m ON m.id=bm.id")).rows;
    for (const target of targets) {
      await storage.send(new PutObjectCommand({ Bucket: target.bucket, Key: target.object_key, Body: files.get(target.sha256)!, ContentType: target.content_type }));
      const saved = await (await storage.send(new GetObjectCommand({ Bucket: target.bucket, Key: target.object_key }))).Body?.transformToByteArray();
      if (!saved || createHash("sha256").update(saved).digest("hex") !== target.sha256) throw new Error(`Stored media integrity failed: ${target.object_key}`);
    }
    await client.query("COMMIT");
    console.log("APPLIED", report);
  }
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally { client.release(); storage.destroy(); await pool.end(); }
