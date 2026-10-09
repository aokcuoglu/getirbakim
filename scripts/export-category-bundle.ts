import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";

// Writes the Trodo category tree, labels, images and product mappings to a bundle that
// scripts/import-category-bundle.ts loads into another database with the same supplier item ids.
const root = resolve(process.argv[2] || ".local/category-bundle");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = objectStorage();
try {
  const rows = async (sql: string) => (await pool.query(sql)).rows;
  const media = await rows(`SELECT m.* FROM product_media_objects m WHERE m.id IN (SELECT media_id FROM source_category_images) ORDER BY m.id`);
  for (const object of media) {
    const path = resolve(root, "media", object.object_key);
    if (!path.startsWith(resolve(root, "media") + sep)) throw new Error("Unsafe media key");
    const result = await storage.send(new GetObjectCommand({ Bucket: object.bucket, Key: object.object_key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes || bytes.length !== object.size_bytes || createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error(`Media integrity failed: ${object.object_key}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  const manifest = {
    exportedAt: new Date().toISOString(),
    categories: await rows("SELECT * FROM source_categories ORDER BY source,category_id"),
    labels: await rows("SELECT * FROM source_category_labels ORDER BY source,category_id,locale"),
    media,
    images: await rows("SELECT * FROM source_category_images ORDER BY source,category_id"),
    products: await rows("SELECT * FROM product_source_categories ORDER BY supplier_item_id,source,category_id"),
  };
  await writeFile(resolve(root, "manifest.json"), JSON.stringify(manifest));
  console.log(`Exported ${manifest.categories.length} categories, ${manifest.labels.length} labels, ${manifest.images.length} images (${media.length} media objects), ${manifest.products.length} product mappings to ${root}`);
} finally { storage.destroy(); await pool.end(); }
