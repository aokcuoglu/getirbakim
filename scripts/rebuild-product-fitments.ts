import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { lockFitmentSync, loadFitmentMatcher, syncProductFitments } from "../src/modules/store/fitment-sync";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await lockFitmentSync(client);
  await client.query(await readFile("db/product-fitments.sql", "utf8"));
  const matcher = await loadFitmentMatcher(client);
  const products = (await client.query<{ supplier_item_id: string; manufacturer: string; manufacturer_part_number: string; payload: unknown }>(
    "SELECT supplier_item_id,manufacturer,manufacturer_part_number,payload FROM product_enrichments ORDER BY supplier_item_id FOR UPDATE")).rows;
  const results = [];
  for (const product of products) results.push({ product: `${product.manufacturer} ${product.manufacturer_part_number}`,
    counts: await syncProductFitments(client, product.supplier_item_id, product.payload, matcher) });
  await client.query("COMMIT");
  console.log(JSON.stringify({ products: products.length, results }, null, 2));
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
