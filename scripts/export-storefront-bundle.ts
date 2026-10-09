import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";

// Writes storefront data produced locally (Trodo category tree, labels, images, product
// mappings, product enrichments with their images, manufacturer logos) to a bundle that
// scripts/import-storefront-bundle.ts loads into a database with the same supplier item ids.
// Enrichment runs, request logs and caches stay local; vehicle fitments are rebuilt after import.
const root = resolve(process.argv[2] || ".local/storefront-bundle");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = objectStorage();
const client = await pool.connect();
try {
  // One snapshot so mappings, enrichments and media agree while a local worker keeps writing.
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const read = async (sql: string) => (await client.query(sql)).rows;
  const manifest = {
    exportedAt: new Date().toISOString(),
    categories: await read("SELECT * FROM source_categories ORDER BY source,category_id"),
    labels: await read("SELECT * FROM source_category_labels ORDER BY source,category_id,locale"),
    images: await read("SELECT * FROM source_category_images ORDER BY source,category_id"),
    products: await read("SELECT * FROM product_source_categories ORDER BY supplier_item_id,source,category_id"),
    enrichments: await read("SELECT * FROM product_enrichments ORDER BY supplier_item_id"),
    // Hex bytea text survives JSON; the driver's Buffer would not.
    logos: await read(`SELECT brand_key,manufacturer,'\\x'||encode(image_data,'hex') AS image_data,sha256,width,height,source_url,evidence_product_id,evidence_source_url,imported_at
      FROM manufacturer_logos ORDER BY brand_key`),
    media: await read(`SELECT * FROM product_media_objects WHERE id IN (SELECT media_id FROM source_category_images UNION SELECT image_id FROM product_enrichments) ORDER BY id`),
  };
  await client.query("COMMIT");
  for (const object of manifest.media) {
    const path = resolve(root, "media", object.object_key);
    if (!path.startsWith(resolve(root, "media") + sep)) throw new Error("Unsafe media key");
    const result = await storage.send(new GetObjectCommand({ Bucket: object.bucket, Key: object.object_key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes || bytes.length !== object.size_bytes || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error(`Media integrity failed: ${object.object_key}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest));
  console.log(`Exported ${manifest.categories.length} categories, ${manifest.labels.length} labels, ${manifest.images.length} category images, ${manifest.products.length} product mappings, ${manifest.enrichments.length} enrichments, ${manifest.logos.length} logos, ${manifest.media.length} media objects to ${root}`);
} finally { client.release(); storage.destroy(); await pool.end(); }
