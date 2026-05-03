import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL is not set.");
    console.error("Set it in your .env file or export it before running this script.");
    process.exit(1);
  }

  console.log("=== Existing Supabase Catalog DB Inspection ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("DATABASE_URL: [REDACTED]");
  console.log("");

  const schema = process.env.SUPPLIER_DB_SCHEMA || "public";
  const table = process.env.SUPPLIER_CATALOG_TABLE || "supplier_products";

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query("SELECT 1");
    console.log("Connection: OK");
  } catch (err) {
    console.error("Connection: FAILED");
    console.error("Error message only (no credentials):", (err as Error).message);
    await pool.end();
    process.exit(1);
  }

  console.log(`Schema: ${schema}`);
  console.log(`Table: ${table}`);
  console.log("");

  // Check if table exists
  const tableCheck = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)`,
    [schema, table]
  );

  if (!tableCheck.rows[0].exists) {
    console.error(`Table ${schema}.${table} does not exist.`);
    await pool.end();
    process.exit(1);
  }

  // List columns
  const columnsResult = await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  );

  console.log("=== Columns ===");
  console.log("Column Name | Data Type | Nullable | Default");
  console.log("---|---|---|---");
  for (const col of columnsResult.rows) {
    const def = col.column_default || "(none)";
    console.log(`${col.column_name} | ${col.data_type} | ${col.is_nullable} | ${def}`);
  }
  console.log("");

  // List indexes
  const indexesResult = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
    [schema, table]
  );

  console.log("=== Indexes ===");
  if (indexesResult.rows.length === 0) {
    console.log("(no custom indexes found)");
  } else {
    for (const idx of indexesResult.rows) {
      console.log(`${idx.indexname}: ${idx.indexdef}`);
    }
  }
  console.log("");

  // Total row count
  const countResult = await pool.query(`SELECT COUNT(*)::bigint as count FROM ${schema}.${table}`);
  const totalCount = Number(countResult.rows[0].count);
  console.log(`=== Total Rows ===`);
  console.log(`${totalCount.toLocaleString()}`);
  console.log("");

  // Get provider names from supplier_providers
  const providerMap = new Map<number, string>();
  try {
    const providers = await pool.query("SELECT id, name FROM supplier_providers ORDER BY id");
    console.log("=== Supplier Providers ===");
    for (const row of providers.rows) {
      providerMap.set(row.id, row.name);
      console.log(`  provider_id ${row.id}: ${row.name}`);
    }
    console.log("");
  } catch {
    console.log("(supplier_providers table not accessible, using provider_id directly)");
    console.log("");
  }

  // Count by provider_id
  console.log("=== Row Counts by Supplier (provider_id) ===");
  const supplierCounts = await pool.query(
    `SELECT provider_id, COUNT(*)::bigint as count FROM ${schema}.${table} GROUP BY provider_id ORDER BY count DESC`
  );
  for (const row of supplierCounts.rows) {
    const name = providerMap.get(row.provider_id) ?? `Provider ${row.provider_id}`;
    console.log(`  ${name} (provider_id=${row.provider_id}): ${Number(row.count).toLocaleString()}`);
  }
  console.log("");

  // Sample rows (max 5, safe fields only)
  console.log("=== Sample Rows (max 5, safe fields only) ===");
  const sampleResult = await pool.query(
    `SELECT id, provider_id, supplier_sku, supplier_brand, supplier_name, normalized_sku,
            supplier_price, supplier_stock_qty, currency, image_url, last_seen_at, created_at, updated_at
     FROM ${schema}.${table} LIMIT 5`
  );

  const sensitiveFields = new Set(["raw_json", "raw_payload", "payload", "response", "api_response"]);

  for (let i = 0; i < sampleResult.rows.length; i++) {
    const row = sampleResult.rows[i];
    console.log(`--- Row ${i + 1} ---`);
    for (const [key, val] of Object.entries(row)) {
      if (sensitiveFields.has(key.toLowerCase())) {
        console.log(`  ${key}: [REDACTED]`);
      } else if (val === null || val === undefined) {
        console.log(`  ${key}: (null)`);
      } else if (typeof val === "string" && val.length > 80) {
        console.log(`  ${key}: ${val.substring(0, 80)}... [truncated]`);
      } else {
        console.log(`  ${key}: ${val}`);
      }
    }
  }
  console.log("");

  // List all tables for reference
  console.log("=== All Public Tables ===");
  const allTables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  for (const row of allTables.rows) {
    console.log(`  ${row.table_name}`);
  }
  console.log("");

  console.log("=== Inspection Complete ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Inspection failed:", err.message);
  process.exit(1);
});