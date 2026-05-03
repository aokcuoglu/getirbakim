import "dotenv/config";
import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DIRECT_URL or DATABASE_URL is not set.");
    process.exit(1);
  }

  console.log("=== Search Performance Diagnostic ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("Connection: [REDACTED]");
  console.log("");

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  const queries = [
    {
      label: "Free-text ILIKE on normalized_name (Bosch)",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM supplier_products WHERE normalized_name ILIKE '%Bosch%' LIMIT 25`,
    },
    {
      label: "Free-text ILIKE on supplier_brand (Bosch)",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM supplier_products WHERE supplier_brand ILIKE '%Bosch%' LIMIT 25`,
    },
    {
      label: "Multi-column ILIKE (Bosch search pattern)",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM supplier_products WHERE supplier_name ILIKE '%Bosch%' OR supplier_brand ILIKE '%Bosch%' OR normalized_name ILIKE '%Bosch%' LIMIT 25`,
    },
    {
      label: "Exact SKU lookup",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM supplier_products WHERE supplier_sku = 'ANKA20100020'`,
    },
    {
      label: "Provider join",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM supplier_products WHERE provider_id IN (SELECT id FROM supplier_providers WHERE name ILIKE '%Dinamik%') LIMIT 25`,
    },
    {
      label: "OEM EXISTS subquery",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM supplier_products WHERE EXISTS (SELECT 1 FROM supplier_product_oems spo WHERE spo.supplier_product_id = supplier_products.id AND spo.is_active = true AND spo.oem_code ILIKE '%Bosch%') LIMIT 25`,
    },
    {
      label: "Stock + price filter",
      sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM supplier_products WHERE supplier_stock_qty > 0 AND supplier_price > 0 ORDER BY updated_at DESC LIMIT 25`,
    },
  ];

  for (const q of queries) {
    console.log(`--- ${q.label} ---`);
    try {
      const result = await pool.query(q.sql);
      for (const row of result.rows) {
        const line = Object.values(row).join("");
        console.log(line);
      }
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
    }
    console.log("");
  }

  console.log("=== Diagnostic Complete ===");
  await pool.end();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err.message);
  process.exit(1);
});