import { existsSync } from "node:fs";
import { Pool } from "pg";
import { objectStorage } from "../src/lib/object-storage";
import { collectMedia, parseMediaGcArgs } from "../src/modules/enrichment/media-gc";
import { LOCK_PATH } from "./storefront-sync-state";

// npm run media:gc [--apply] [--min-age-days=N] [--limit=N] [--batch=N] [--max-share=0..1] (#597, docs/product-enrichment.md).
// Without --apply it only reports. Media ids differ between environments, so each environment runs it on its own.
const args = parseMediaGcArgs(process.argv.slice(2));
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error("S3_BUCKET is required");
if (args.apply && existsSync(LOCK_PATH)) throw new Error(`A storefront sync is running (${LOCK_PATH}); run --apply after it finished.`);
const storage = objectStorage();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  // The bucket belongs to this one database: the output names both, so a run against the wrong pair stands out.
  const database = (await pool.query<{ name: string }>("SELECT current_database() AS name")).rows[0].name;
  const result = await collectMedia(pool, storage, { ...args, bucket });
  console.log(JSON.stringify({ mode: args.apply ? "APPLIED" : "DRY RUN", database, bucket, minAgeDays: args.minAgeDays, limit: args.limit, ...result }, null, 2));
} finally {
  storage.destroy();
  await pool.end();
}
