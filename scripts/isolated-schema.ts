import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { migrateSupplierSnapshots } from "../src/modules/suppliers/sync";

// The schema files scripts/setup.ts applies, in its order.
export const setupFiles = ["schema", "brand-launch", "vehicle-schema", "vehicle-oil-specs", "commerce", "search", "search-analytics", "garage", "account-addresses", "product-enrichment",
  "manual-supplier", "manufacturer-logos", "vehicle-type-specs", "enrichment-worker", "product-fitments", "source-categories", "product-matching", "product-overrides",
  "product-override-images", "product-override-references", "product-override-specs", "product-override-fitments", "storefront-catalog", "restock-requests", "enrichment-products", "enrichment-states", "enrichment-search", "enrichment-shared-links", "enrichment-tombstones", "storefront-make-fits", "newsletter", "indexnow"];

/** Applies every setup file on `client` in scripts/setup.ts's order, with the supplier snapshot migration before commerce. */
export async function applySetupFiles(client: PoolClient) {
  for (const file of setupFiles) {
    if (file === "commerce") await migrateSupplierSnapshots(client);
    await client.query(await readFile(`db/${file}.sql`, "utf8"));
  }
}

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
  // On a fresh database the extension would otherwise land in the first search_path schema (the isolated one) and
  // vanish with its CASCADE drop, breaking parallel test files. Concurrent creators may race: that is fine.
  try {
    await root.query("CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "23505" && code !== "42710") throw error;
  }
  await root.query(`CREATE SCHEMA ${name}`);
  const url = new URL(original);
  url.searchParams.set("options", `-c search_path=${name},public`);
  const pool = new Pool({ connectionString: url.toString() });
  const client = await pool.connect();
  try {
    await applySetupFiles(client);
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
