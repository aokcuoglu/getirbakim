import "dotenv/config";
import { Pool } from "pg";

const INDEX_SQL: { name: string; sql: string }[] = [
  {
    name: "pg_trgm extension",
    sql: "CREATE EXTENSION IF NOT EXISTS pg_trgm",
  },
  {
    name: "idx_supplier_products_normalized_name_trgm",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_normalized_name_trgm ON supplier_products USING gin (normalized_name gin_trgm_ops)",
  },
  {
    name: "idx_supplier_products_supplier_name_trgm",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_name_trgm ON supplier_products USING gin (supplier_name gin_trgm_ops)",
  },
  {
    name: "idx_supplier_products_provider_id",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_provider_id ON supplier_products (provider_id)",
  },
  {
    name: "idx_supplier_products_supplier_sku",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_sku ON supplier_products (supplier_sku)",
  },
  {
    name: "idx_supplier_products_normalized_sku",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_normalized_sku ON supplier_products (normalized_sku)",
  },
  {
    name: "idx_supplier_products_supplier_brand",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_brand ON supplier_products (supplier_brand)",
  },
  {
    name: "idx_supplier_products_supplier_brand_trgm",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_brand_trgm ON supplier_products USING gin (supplier_brand gin_trgm_ops)",
  },
  {
    name: "idx_supplier_products_supplier_price",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_price ON supplier_products (supplier_price)",
  },
  {
    name: "idx_supplier_products_supplier_stock_qty",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_products_supplier_stock_qty ON supplier_products (supplier_stock_qty)",
  },
  {
    name: "idx_supplier_product_oems_normalized_oem_code",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_normalized_oem_code ON supplier_product_oems (normalized_oem_code)",
  },
  {
    name: "idx_supplier_product_oems_supplier_product_id",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_supplier_product_id ON supplier_product_oems (supplier_product_id) WHERE is_active = true",
  },
  {
    name: "idx_supplier_product_oems_oem_code",
    sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_product_oems_oem_code ON supplier_product_oems (oem_code) WHERE is_active = true",
  },
];

const ANALYZE_SQL = [
  "ANALYZE supplier_products",
  "ANALYZE supplier_product_oems",
];

async function getExistingIndexes(pool: Pool): Promise<Set<string>> {
  const result = await pool.query(
    `SELECT i.relname as index_name
     FROM pg_index idx
     JOIN pg_class i ON i.oid = idx.indexrelid
     JOIN pg_class t ON t.oid = idx.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE t.relname IN ('supplier_products', 'supplier_product_oems', 'supplier_providers')
       AND n.nspname = 'public'`
  );
  return new Set(result.rows.map((r: { index_name: string }) => r.index_name));
}

async function main() {
  const applyFlag = process.env.APPLY_SEARCH_INDEXES;
  if (applyFlag !== "true") {
    console.log("APPLY_SEARCH_INDEXES is not set to 'true'.");
    console.log("To apply search indexes, run:");
    console.log("  APPLY_SEARCH_INDEXES=true npx tsx scripts/apply-search-indexes.ts");
    console.log("");
    console.log("This will create the following indexes:");
    for (const idx of INDEX_SQL) {
      console.log(`  - ${idx.name}`);
    }
    console.log("");
    console.log("All statements are additive only (CREATE INDEX CONCURRENTLY IF NOT EXISTS).");
    console.log("No destructive operations will be performed.");
    process.exit(0);
  }

  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DIRECT_URL or DATABASE_URL is not set.");
    process.exit(1);
  }

  console.log("=== Applying Search Indexes (v0.3.3) ===");
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
    console.error("Connection: FAILED -", (err as Error).message);
    await pool.end();
    process.exit(1);
  }

  const existingIndexes = await getExistingIndexes(pool);
  console.log(`Existing indexes found: ${existingIndexes.size}`);
  console.log("");

  for (const idx of INDEX_SQL) {
    if (existingIndexes.has(idx.name)) {
      console.log(`  SKIPPED (already exists): ${idx.name}`);
      continue;
    }

    const start = Date.now();
    console.log(`  CREATING: ${idx.name}...`);

    try {
      await pool.query(idx.sql);
      const duration = Date.now() - start;
      console.log(`  CREATED: ${idx.name} (${duration}ms)`);
    } catch (err) {
      const duration = Date.now() - start;
      const msg = (err as Error).message;
      if (msg.includes("already exists")) {
        console.log(`  SKIPPED (already exists): ${idx.name} (${duration}ms)`);
      } else {
        console.error(`  FAILED: ${idx.name} (${duration}ms) - ${msg}`);
        console.error("  Stopping. Fix the issue and re-run. Already-created indexes are safe.");
        await pool.end();
        process.exit(1);
      }
    }
  }

  console.log("\n  Running ANALYZE...");
  for (const sql of ANALYZE_SQL) {
    const start = Date.now();
    await pool.query(sql);
    console.log(`  ANALYZE done: ${sql.replace("ANALYZE ", "")} (${Date.now() - start}ms)`);
  }

  const newIndexState = await getExistingIndexes(pool);
  console.log("\n=== Final Index State ===");
  for (const idx of INDEX_SQL) {
    if (idx.name === "pg_trgm extension") {
      console.log(`  ${idx.name}: (extension)`);
    } else {
      const exists = newIndexState.has(idx.name);
      console.log(`  ${idx.name}: ${exists ? "EXISTS" : "MISSING"}`);
    }
  }

  console.log("\n=== Index Application Complete ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Apply failed:", err.message);
  process.exit(1);
});