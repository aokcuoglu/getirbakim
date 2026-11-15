import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { migrateSupplierSnapshots } from "../src/modules/suppliers/sync";

// The schema files scripts/setup.ts applies, in its order.
const setupFiles = ["schema", "brand-launch", "vehicle-schema", "vehicle-oil-specs", "commerce", "search", "garage", "product-enrichment",
  "manual-supplier", "manufacturer-logos", "vehicle-type-specs", "enrichment-worker", "product-fitments", "source-categories", "product-matching", "product-overrides",
  "product-override-images", "product-override-references", "product-override-specs", "storefront-catalog", "restock-requests", "enrichment-products", "enrichment-states", "enrichment-search", "enrichment-shared-links", "storefront-make-fits", "newsletter"];

/**
 * A throwaway schema holding the whole application schema, for integration tests that must not touch the shared
 * database's data. `public` stays on the search path only for extensions (pg_trgm); every table, view and function
 * the setup files create lands in the test schema first. Sets DATABASE_URL so modules imported afterwards
 * (src/lib/db) connect to it; `drop` removes the schema.
 */
export async function isolatedSchema(prefix: string) {
  const original = process.env.DATABASE_URL;
  if (!original) throw new Error("DATABASE_URL required");
  const name = `${prefix}_${randomBytes(6).toString("hex")}`;
  const root = new Pool({ connectionString: original });
  await root.query(`CREATE SCHEMA ${name}`);
  const url = new URL(original);
  url.searchParams.set("options", `-c search_path=${name},public`);
  const pool = new Pool({ connectionString: url.toString() });
  const client = await pool.connect();
  try {
    for (const file of setupFiles) {
      if (file === "commerce") await migrateSupplierSnapshots(client);
      await client.query(await readFile(`db/${file}.sql`, "utf8"));
    }
  } catch (error) {
    client.release(); await pool.end(); await root.query(`DROP SCHEMA ${name} CASCADE`); await root.end();
    throw error;
  }
  client.release();
  process.env.DATABASE_URL = url.toString();
  return {
    name, pool,
    async drop() {
      process.env.DATABASE_URL = original;
      await pool.end();
      await root.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
      await root.end();
    },
  };
}
