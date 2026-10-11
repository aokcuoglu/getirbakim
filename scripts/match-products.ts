import { Pool } from "pg";

// Rebuilds cross-supplier match groups, brand-pair suggestions and SETA references (db/product-matching.sql).
// Read-only towards supplier data; takes ~1 minute on the full catalog.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const database = (await pool.query("SELECT current_database() AS name,current_user AS owner")).rows[0];
  if (database.name !== "getirbakim" || database.owner !== "getirbakim_app") throw new Error("Independent database check failed");
  const started = Date.now();
  const { rows } = await pool.query<{ stats: Record<string, number> }>("SELECT refresh_product_matches() AS stats");
  console.log({ seconds: Math.round((Date.now() - started) / 1000), ...rows[0].stats });
} finally { await pool.end(); }
