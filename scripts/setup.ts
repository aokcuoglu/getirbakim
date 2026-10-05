import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { hash } from "bcryptjs";
import { migrateSupplierSnapshots } from "../src/modules/suppliers/sync";
import { newPasswordSchema } from "../src/modules/auth/schemas";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
 const { rows } = await pool.query("select current_database() as name, current_user as owner");
 if (rows[0].name !== "getirbakim" || rows[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
 const client = await pool.connect();
 try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(20261001,1)");
  await client.query(await readFile("db/schema.sql", "utf8"));
  await client.query(await readFile("db/brand-launch.sql", "utf8"));
  await client.query(await readFile("db/vehicle-schema.sql", "utf8"));
  await migrateSupplierSnapshots(client);
  await client.query(await readFile("db/commerce.sql", "utf8"));
  await client.query(await readFile("db/product-enrichment.sql", "utf8"));
  await client.query(await readFile("db/manufacturer-logos.sql", "utf8"));
  await client.query(await readFile("db/enrichment-worker.sql", "utf8"));
  await client.query(await readFile("db/product-fitments.sql", "utf8"));
  await client.query("COMMIT");
 } catch (error) { await client.query("ROLLBACK"); throw error; }
 finally { client.release(); }
 if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error("Admin credentials required");
 const password = newPasswordSchema.parse(process.env.ADMIN_PASSWORD);
 await pool.query("INSERT INTO accounts (name,email,password_hash,role,approved) VALUES ($1,$2,$3,'admin',true) ON CONFLICT (email) DO NOTHING", ["Getirbakim Yönetim", process.env.ADMIN_EMAIL, await hash(password,12)]);
 console.log("Database getirbakim / getirbakim_app verified. Schema and administrator ready.");
} finally { await pool.end(); }
