import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { lockFitmentSync, loadFitmentMatcher, syncProductFitments } from "../src/modules/store/fitment-sync";
import { readVehicleCatalogImport } from "../src/modules/store/vehicle-catalog-import";

// Add/update in one transaction. Existing IDs are never deleted by an import.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const source = await readVehicleCatalogImport();
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT current_database() AS name, current_user AS owner");
    if (rows[0].name !== "getirbakim" || rows[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
    await client.query("BEGIN");
    await lockFitmentSync(client);
    await client.query(await readFile("db/vehicle-schema.sql", "utf8"));
    const specs = [
      { table: "vehicle_brands", rows: source.brands, fields: "id integer, name text, display_name text, popular boolean" },
      { table: "vehicle_models", rows: source.models, fields: "id integer, brand_id integer, name text, date_from date, date_to date" },
      { table: "vehicle_types", rows: source.vehicles, fields: "id integer, model_id integer, name text, cc integer, fuel_type text, fuel_name text, hp integer, kwt integer, year_of_constr_from date, year_of_constr_to date, search_text text" },
    ];
    for (const spec of specs) {
      const columns = spec.fields.split(", ").map(field => field.split(" ")[0]);
      const mutable = columns.filter(column => column !== "id");
      const updates = mutable.map(column => `${column}=EXCLUDED.${column}`).join(", ");
      const before = mutable.map(column => `${spec.table}.${column}`).join(", ");
      const after = mutable.map(column => `EXCLUDED.${column}`).join(", ");
      let changed = 0;
      for (let offset = 0; offset < spec.rows.length; offset += 1000) {
        const result = await client.query(`INSERT INTO ${spec.table} (${columns.join(", ")})
          SELECT ${columns.join(", ")} FROM jsonb_to_recordset($1::jsonb) AS source(${spec.fields})
          ON CONFLICT (id) DO UPDATE SET ${updates}, updated_at=now()
          WHERE ROW(${before}) IS DISTINCT FROM ROW(${after})`, [JSON.stringify(spec.rows.slice(offset, offset + 1000))]);
        changed += result.rowCount ?? 0;
      }
      console.log(`${spec.table}: ${spec.rows.length} source rows, ${changed} added/updated (pending commit)`);
    }
    // Reconcile installed product links against the new catalog in this transaction.
    const fitmentsInstalled = (await client.query("SELECT to_regclass('product_vehicle_fitments') IS NOT NULL AS installed")).rows[0].installed;
    if (fitmentsInstalled) {
      const matcher = await loadFitmentMatcher(client);
      const products = (await client.query("SELECT supplier_item_id,payload FROM product_enrichments ORDER BY supplier_item_id FOR UPDATE")).rows;
      for (const product of products) await syncProductFitments(client, product.supplier_item_id, product.payload, matcher);
      console.log(`Product vehicle links: ${products.length} products reconciled (pending commit)`);
    }
    await client.query("COMMIT");
    await client.query("ANALYZE vehicle_brands, vehicle_models, vehicle_types");
    console.log("TecDoc import committed; brands, models and vehicle types are ready.");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
