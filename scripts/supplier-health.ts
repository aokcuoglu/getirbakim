import { Pool } from "pg";
import { supplierHealth } from "../src/modules/suppliers/health";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const health = await supplierHealth(pool);
  console.log(JSON.stringify(health, null, 2));
  if (!health.healthy) process.exitCode = 1;
} catch { console.error("Supplier health check failed; database access and schema should be checked."); process.exitCode = 1; }
finally { await pool.end(); }
