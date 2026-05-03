import "dotenv/config";
import { Pool } from "pg";

const RECOMMENDED_INDEXES = [
  { name: "idx_supplier_products_normalized_name_trgm", table: "supplier_products" },
  { name: "idx_supplier_products_supplier_name_trgm", table: "supplier_products" },
  { name: "idx_supplier_products_supplier_brand_trgm", table: "supplier_products" },
  { name: "idx_supplier_products_supplier_sku", table: "supplier_products" },
  { name: "idx_supplier_products_normalized_sku", table: "supplier_products" },
  { name: "idx_supplier_products_supplier_brand", table: "supplier_products" },
  { name: "idx_supplier_products_provider_id", table: "supplier_products" },
  { name: "idx_supplier_products_supplier_price", table: "supplier_products" },
  { name: "idx_supplier_products_supplier_stock_qty", table: "supplier_products" },
  { name: "idx_supplier_product_oems_normalized_oem_code", table: "supplier_product_oems" },
  { name: "idx_supplier_product_oems_supplier_product_id", table: "supplier_product_oems" },
  { name: "idx_supplier_product_oems_oem_code", table: "supplier_product_oems" },
];

async function main() {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DIRECT_URL or DATABASE_URL is not set.");
    process.exit(1);
  }

  console.log("=== Search Index Inspection ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("Connection: [REDACTED]");
  console.log("");

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await pool.query("SELECT 1");
    console.log("Connection: OK");
  } catch (err) {
    console.error("Connection: FAILED");
    console.error("Error:", (err as Error).message);
    await pool.end();
    process.exit(1);
  }

  const tables = ["supplier_products", "supplier_product_oems", "supplier_providers"];

  for (const table of tables) {
    console.log(`\n=== Indexes on ${table} ===`);

    const indexesResult = await pool.query(
      `SELECT i.relname as index_name,
              am.amname as index_type,
              idx.indisunique as is_unique,
              pg_get_indexdef(idx.indexrelid) as index_def
       FROM pg_index idx
       JOIN pg_class i ON i.oid = idx.indexrelid
       JOIN pg_class t ON t.oid = idx.indrelid
       JOIN pg_am am ON am.oid = i.relam
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE t.relname = $1 AND n.nspname = 'public'
       ORDER BY i.relname`,
      [table]
    );

    if (indexesResult.rows.length === 0) {
      console.log("  (no indexes found)");
    } else {
      for (const row of indexesResult.rows) {
        const unique = row.is_unique ? "UNIQUE " : "";
        console.log(`  ${row.index_name} [${unique}${row.index_type}]`);
        console.log(`    ${row.index_def}`);
      }
    }
  }

  console.log("\n=== pg_trgm Extension ===");
  const extResult = await pool.query(
    `SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm'`
  );
  if (extResult.rows.length > 0) {
    console.log(`  pg_trgm: installed (version ${extResult.rows[0].extversion})`);
  } else {
    console.log("  pg_trgm: NOT installed");
  }

  const availableResult = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') as available`
  );
  console.log(`  pg_trgm available for install: ${availableResult.rows[0].available}`);

  console.log("\n=== Recommended Index Status ===");
  const existingIndexes = new Set<string>();
  for (const table of tables) {
    const result = await pool.query(
      `SELECT i.relname as index_name
       FROM pg_index idx
       JOIN pg_class i ON i.oid = idx.indexrelid
       JOIN pg_class t ON t.oid = idx.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE t.relname = $1 AND n.nspname = 'public'`,
      [table]
    );
    for (const row of result.rows) {
      existingIndexes.add(row.index_name);
    }
  }

  for (const rec of RECOMMENDED_INDEXES) {
    const exists = existingIndexes.has(rec.name);
    console.log(`  ${rec.name} (${rec.table}): ${exists ? "EXISTS" : "MISSING"}`);
  }

  console.log("\n=== Table Row Counts ===");
  for (const table of tables) {
    try {
      const countResult = await pool.query(`SELECT COUNT(*)::bigint as count FROM ${table}`);
      console.log(`  ${table}: ${Number(countResult.rows[0].count).toLocaleString()} rows`);
    } catch {
      console.log(`  ${table}: (not accessible)`);
    }
  }

  console.log("\n=== Inspection Complete ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Inspection failed:", err.message);
  process.exit(1);
});