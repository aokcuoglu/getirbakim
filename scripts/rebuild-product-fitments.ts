import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { lockFitmentSync, rebuildProductFitments } from "../src/modules/store/fitment-sync";
import { parseRebuildArgs, parseRebuildItems } from "./fitment-rebuild-args";

// Derives product_vehicle_fitments from the stored enrichment payloads in one transaction.
// No arguments: every enrichment (npm run fitment:rebuild, production-task.sh rebuild-fitments).
// --items=<file>: a JSON array of supplier item ids (import-storefront-inbound.ts passes what the bundle wrote) plus
// every product whose fitments came from an older matcher version.
const args = parseRebuildArgs(process.argv.slice(2));
const items = args.itemsFile === null ? undefined : parseRebuildItems(await readFile(args.itemsFile, "utf8"));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // Before the schema file, as before; rebuildProductFitments takes the same (re-entrant) locks again.
  await lockFitmentSync(client);
  await client.query(await readFile("db/product-fitments.sql", "utf8"));
  const result = await rebuildProductFitments(client, { items });
  await client.query("COMMIT");
  console.log(JSON.stringify(result));
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
