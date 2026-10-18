import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { parseVehicleCsv } from "../src/modules/store/vehicle-catalog-import";
import { parseVehicleOilRow } from "../src/modules/store/vehicle-oil";

// Recommended engine oil per vehicle type (data/vehicle_type_oil_specs.csv, from the TecDoc oil-capacity sheet).
// Upserts in one transaction; rows of vehicle types the catalog does not know are skipped and counted.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const rows = parseVehicleCsv(await readFile(path.join(process.cwd(), "data", "vehicle_type_oil_specs.csv"), "utf8")).map(parseVehicleOilRow);
  if (!rows.length || new Set(rows.map(row => row.vehicle_type_id)).size !== rows.length) throw new Error("Empty or duplicate vehicle oil rows");
  const client = await pool.connect();
  try {
    const { rows: identity } = await client.query("SELECT current_database() AS name, current_user AS owner");
    if (identity[0].name !== "getirbakim" || identity[0].owner !== "getirbakim_app") throw new Error("Independent database check failed");
    await client.query("BEGIN");
    await client.query(await readFile("db/vehicle-oil-specs.sql", "utf8"));
    let changed = 0, skipped = 0;
    for (let offset = 0; offset < rows.length; offset += 1000) {
      const batch = JSON.stringify(rows.slice(offset, offset + 1000));
      const result = await client.query(`INSERT INTO vehicle_type_oil_specs (vehicle_type_id,viscosities,acea,api,approvals,capacity_min_l,capacity_max_l)
        SELECT source.vehicle_type_id,ARRAY(SELECT jsonb_array_elements_text(source.viscosities)),ARRAY(SELECT jsonb_array_elements_text(source.acea)),
         ARRAY(SELECT jsonb_array_elements_text(source.api)),ARRAY(SELECT jsonb_array_elements_text(source.approvals)),source.capacity_min_l,source.capacity_max_l
        FROM jsonb_to_recordset($1::jsonb) AS source(vehicle_type_id integer, viscosities jsonb, acea jsonb, api jsonb, approvals jsonb, capacity_min_l numeric, capacity_max_l numeric)
        JOIN vehicle_types v ON v.id=source.vehicle_type_id
        ON CONFLICT (vehicle_type_id) DO UPDATE SET viscosities=EXCLUDED.viscosities, acea=EXCLUDED.acea, api=EXCLUDED.api, approvals=EXCLUDED.approvals,
         capacity_min_l=EXCLUDED.capacity_min_l, capacity_max_l=EXCLUDED.capacity_max_l, updated_at=now()
        WHERE ROW(vehicle_type_oil_specs.viscosities,vehicle_type_oil_specs.acea,vehicle_type_oil_specs.api,vehicle_type_oil_specs.approvals,
         vehicle_type_oil_specs.capacity_min_l,vehicle_type_oil_specs.capacity_max_l)
         IS DISTINCT FROM ROW(EXCLUDED.viscosities,EXCLUDED.acea,EXCLUDED.api,EXCLUDED.approvals,EXCLUDED.capacity_min_l,EXCLUDED.capacity_max_l)`, [batch]);
      changed += result.rowCount ?? 0;
      skipped += Number((await client.query(`SELECT count(*) FROM jsonb_to_recordset($1::jsonb) AS source(vehicle_type_id integer)
        WHERE NOT EXISTS (SELECT 1 FROM vehicle_types v WHERE v.id=source.vehicle_type_id)`, [batch])).rows[0].count);
    }
    await client.query("COMMIT");
    console.log(`vehicle_type_oil_specs: ${rows.length} source rows, ${changed} added/updated, ${skipped} skipped (unknown vehicle type).`);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
