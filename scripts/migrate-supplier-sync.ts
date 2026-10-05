import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Pool } from "pg";
import { migrateSupplierSnapshots } from "../src/modules/suppliers/sync";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  const database = (await client.query("SELECT current_database() AS name,current_user AS owner")).rows[0];
  if (database.name !== "getirbakim" || database.owner !== "getirbakim_app") throw new Error("Independent database check failed");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(20261001,1)");
  // Preserve original imports/items before changing schema or replaying history.
  const backup = {
    imports: (await client.query("SELECT * FROM supplier_imports ORDER BY completed_at,id")).rows,
    items: (await client.query("SELECT * FROM supplier_import_items ORDER BY import_id,code")).rows,
  };
  await mkdir(".local/supplier-backups", { recursive: true, mode: 0o700 });
  const path = `.local/supplier-backups/pre-sync-${Date.now()}.json.gz`;
  await writeFile(path, gzipSync(JSON.stringify(backup)), { mode: 0o600 });
  await client.query(await readFile("db/schema.sql", "utf8"));
  await migrateSupplierSnapshots(client);
  await client.query("COMMIT");
  const result = (await client.query("SELECT (SELECT count(*) FROM supplier_items) AS current_items,(SELECT count(*) FROM supplier_item_changes) AS change_events,(SELECT count(*) FROM supplier_import_items) AS legacy_raw_items")).rows[0];
  console.log({ backup: path, ...result });
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { client.release(); await pool.end(); }
