import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { hash } from "bcryptjs";
import { migrateSupplierSnapshots } from "../src/modules/suppliers/sync";
import { newPasswordSchema } from "../src/modules/auth/schemas";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
 const { rows } = await pool.query("select current_database() as name, current_user as owner");
 if (rows[0].name !== "getirbakim" || rows[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
 // The schema runs while the previous release still serves traffic. Its catalog queries read views and
 // tables this transaction replaces, so a lock wait can deadlock with them (40P01) or, with lock_timeout,
 // give up (55P03) instead of stalling every reader queued behind it. Both roll back cleanly: retry.
 for (let attempt = 1; ; attempt++) {
  const client = await pool.connect();
  try {
   await client.query("BEGIN");
   await client.query("SET LOCAL lock_timeout = '15s'");
   await client.query("SELECT pg_advisory_xact_lock(20261001,1)");
   // SETA imports hold their own lock (seta-import.ts); schema changes wait for both.
   await client.query("SELECT pg_advisory_xact_lock(20261001,4)");
   await client.query(await readFile("db/schema.sql", "utf8"));
   await client.query(await readFile("db/brand-launch.sql", "utf8"));
   await client.query(await readFile("db/vehicle-schema.sql", "utf8"));
   await migrateSupplierSnapshots(client);
   await client.query(await readFile("db/commerce.sql", "utf8"));
   await client.query(await readFile("db/search.sql", "utf8"));
   await client.query(await readFile("db/garage.sql", "utf8"));
   await client.query(await readFile("db/product-enrichment.sql", "utf8"));
   await client.query(await readFile("db/manufacturer-logos.sql", "utf8"));
   await client.query(await readFile("db/enrichment-worker.sql", "utf8"));
   await client.query(await readFile("db/product-fitments.sql", "utf8"));
   await client.query(await readFile("db/source-categories.sql", "utf8"));
   await client.query(await readFile("db/newsletter.sql", "utf8"));
   await client.query("COMMIT");
   break;
  } catch (error) {
   await client.query("ROLLBACK");
   const code = (error as { code?: string }).code;
   if (attempt >= 6 || (code !== "40P01" && code !== "55P03")) throw error;
   console.warn(`Schema attempt ${attempt} hit a lock conflict with live queries (${code}); retrying.`);
   await new Promise(resolve => setTimeout(resolve, attempt * 5000));
  } finally { client.release(); }
 }
 if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error("Admin credentials required");
 const password = newPasswordSchema.parse(process.env.ADMIN_PASSWORD);
 await pool.query("INSERT INTO accounts (name,email,password_hash,role,approved) VALUES ($1,$2,$3,'admin',true) ON CONFLICT (email) DO NOTHING", ["Getirbakim Yönetim", process.env.ADMIN_EMAIL, await hash(password,12)]);
 console.log("Database getirbakim / getirbakim_app verified. Schema and administrator ready.");
} finally { await pool.end(); }
