import { readFile } from "node:fs/promises";
import { Pool } from "pg";
const pool=new Pool({connectionString:process.env.DATABASE_URL});
const client=await pool.connect();
try {
  const database=(await client.query("SELECT current_database() AS name,current_user AS owner")).rows[0];
  if(database.name!=="getirbakim" || database.owner!=="getirbakim_app") throw new Error("Independent database check failed");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(20261001,2)");
  await client.query("SELECT pg_advisory_xact_lock(20261001,1)");
  await client.query(await readFile("db/schema.sql","utf8"));
  await client.query(await readFile("db/commerce.sql","utf8"));
  // Enable commercial refresh only for already authorized and verified active scopes.
  const result=await client.query(`UPDATE supplier_sync_scopes SET commerce_enabled=true,
    commerce_last_success_at=COALESCE(commerce_last_success_at,last_success_at)
    WHERE supplier='basbug' AND warehouse='MRK' AND enabled RETURNING list_group,commerce_interval_minutes,commerce_stale_minutes`);
  await client.query("COMMIT");
  console.log({configured:result.rows});
} catch { await client.query("ROLLBACK"); console.error("Automation migration failed; no changes applied."); process.exitCode=1; }
finally {client.release();await pool.end();}
