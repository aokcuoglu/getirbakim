import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";

// Loads a bundle from scripts/export-category-bundle.ts. Dry run by default; --apply writes.
// Idempotent: categories and labels are upserted, media is matched by sha256, and product
// mappings whose supplier item does not exist here are skipped and counted.
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
    files.set(object.object_key, bytes);
  }
  await client.query("BEGIN");
  await client.query(await readFile("db/source-categories.sql", "utf8"));
  const json = (value: unknown) => JSON.stringify(value);
  const categories = await client.query(`INSERT INTO source_categories SELECT * FROM jsonb_populate_recordset(null::source_categories,$1::jsonb)
    ON CONFLICT (source,category_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,name=EXCLUDED.name,slug=EXCLUDED.slug,path_ids=EXCLUDED.path_ids,
    source_url=EXCLUDED.source_url,raw=EXCLUDED.raw,fetched_at=EXCLUDED.fetched_at`, [json(manifest.categories)]);
  const labels = await client.query(`INSERT INTO source_category_labels SELECT * FROM jsonb_populate_recordset(null::source_category_labels,$1::jsonb)
    ON CONFLICT (source,category_id,locale) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug`, [json(manifest.labels)]);
  // Media rows keep their sha256 identity; an existing object with the same content is reused.
  await client.query(`INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url,created_at)
    SELECT id,$2,object_key,sha256,content_type,size_bytes,source_url,created_at FROM jsonb_populate_recordset(null::product_media_objects,$1::jsonb)
    ON CONFLICT DO NOTHING`, [json(manifest.media), bucket]);
  const images = await client.query(`INSERT INTO source_category_images(source,category_id,media_id,width,height)
    SELECT i.source,i.category_id,m.id,i.width,i.height FROM jsonb_populate_recordset(null::source_category_images,$1::jsonb) i
    JOIN jsonb_populate_recordset(null::product_media_objects,$2::jsonb) b ON b.id=i.media_id JOIN product_media_objects m ON m.sha256=b.sha256
    ON CONFLICT (source,category_id) DO UPDATE SET media_id=EXCLUDED.media_id,width=EXCLUDED.width,height=EXCLUDED.height`, [json(manifest.images), json(manifest.media)]);
  const products = await client.query(`INSERT INTO product_source_categories
    SELECT p.* FROM jsonb_populate_recordset(null::product_source_categories,$1::jsonb) p WHERE EXISTS (SELECT 1 FROM supplier_items s WHERE s.id=p.supplier_item_id)
    ON CONFLICT DO NOTHING`, [json(manifest.products)]);
  const present = Number((await client.query(`SELECT count(*) FROM jsonb_populate_recordset(null::product_source_categories,$1::jsonb) p
    WHERE EXISTS (SELECT 1 FROM supplier_items s WHERE s.id=p.supplier_item_id)`, [json(manifest.products)])).rows[0].count);
  const targets = (await client.query<{ bucket: string; object_key: string; sha256: string; content_type: string }>(
    `SELECT DISTINCT m.bucket,m.object_key,m.sha256,m.content_type FROM jsonb_populate_recordset(null::product_media_objects,$1::jsonb) b
     JOIN product_media_objects m ON m.sha256=b.sha256`, [json(manifest.media)])).rows;
  const report = { categories: categories.rowCount, labels: labels.rowCount, images: images.rowCount, media: targets.length,
    productMappings: manifest.products.length, productsInserted: products.rowCount, productsMissingSupplierItem: manifest.products.length - present };
  if (images.rowCount !== manifest.images.length) throw new Error(`Image rows mismatch: ${images.rowCount}/${manifest.images.length}`);
  if (!apply) {
    await client.query("ROLLBACK");
    console.log("DRY RUN (nothing written)", report);
  } else {
    const bySha = new Map<string, Uint8Array>(manifest.media.map((m: { sha256: string; object_key: string }) => [m.sha256, files.get(m.object_key)!]));
    for (const target of targets) {
      const bytes = bySha.get(target.sha256)!;
      await storage.send(new PutObjectCommand({ Bucket: target.bucket, Key: target.object_key, Body: bytes, ContentType: target.content_type }));
      const saved = await (await storage.send(new GetObjectCommand({ Bucket: target.bucket, Key: target.object_key }))).Body?.transformToByteArray();
      if (!saved || createHash("sha256").update(saved).digest("hex") !== target.sha256) throw new Error(`Stored media integrity failed: ${target.object_key}`);
    }
    await client.query("COMMIT");
    console.log("APPLIED", report);
  }
} catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
finally { client.release(); storage.destroy(); await pool.end(); }
