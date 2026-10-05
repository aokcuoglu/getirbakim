import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Pool } from "pg";
if (process.env.APP_ENV !== "production") throw new Error("Production environment required");
const manifest = JSON.parse(await readFile(`${process.argv[2] || '/snapshot'}/manifest.json`, "utf8"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const info = (await pool.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version') AS version")).rows[0];
  assert.equal(info.database, manifest.source.database); assert.equal(info.role, manifest.source.role); assert.ok(info.version.startsWith('18.'));
  for (const [table, count] of Object.entries(manifest.tables)) {
    const parts = table.split('.'); assert.equal(parts.length, 2);
    const identifier = parts.map(value => '"' + value.replaceAll('"', '""') + '"').join('.');
    assert.equal((await pool.query(`SELECT count(*)::text AS count FROM ${identifier}`)).rows[0].count, count, `Restored row count: ${table}`);
  }
  console.log(`PASS PostgreSQL 18 snapshot identity and ${Object.keys(manifest.tables).length} exact table counts`);
} finally { await pool.end(); }
