import assert from "node:assert/strict";
import { Pool } from "pg";
import { lockFitmentSync, loadFitmentMatcher, syncProductFitments } from "../src/modules/store/fitment-sync";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await lockFitmentSync(client);
  const { rows: products } = await client.query("SELECT supplier_item_id,payload FROM product_enrichments ORDER BY supplier_item_id FOR UPDATE");
  const matcher = await loadFitmentMatcher(client);
  const summary = (await client.query(`SELECT match_status,count(*)::int AS count FROM product_vehicle_fitments GROUP BY match_status ORDER BY match_status`)).rows;
  const expected = products.reduce((total, product) => total + product.payload.vehicles.length, 0);
  const observed = summary.reduce((total, row) => total + row.count, 0);
  assert.equal(observed, expected, "Every source vehicle must retain an observation");
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM product_vehicle_fitments f JOIN product_enrichments e USING(supplier_item_id)
    WHERE f.source_vehicle IS DISTINCT FROM e.payload->'vehicles'->f.source_index`)).rows[0].count, 0, "No stale source links");
  assert.equal((await client.query(`SELECT count(*)::int AS count FROM product_vehicle_fitments f LEFT JOIN vehicle_types v ON v.id=f.vehicle_type_id
    LEFT JOIN vehicle_models m ON m.id=v.model_id LEFT JOIN vehicle_brands b ON b.id=m.brand_id
    WHERE f.match_status='matched' AND (v.id IS NULL OR m.id IS NULL OR b.id IS NULL)`)).rows[0].count, 0);
  for (const product of products) {
    const persisted = (await client.query("SELECT source_index,vehicle_type_id,match_status FROM product_vehicle_fitments WHERE supplier_item_id=$1 ORDER BY source_index", [product.supplier_item_id])).rows;
    assert.deepEqual(persisted, product.payload.vehicles.map((vehicle: Parameters<typeof matcher>[0], index: number) => {
      const result = matcher(vehicle, index);
      return { source_index: index, vehicle_type_id: result.typeId, match_status: result.status };
    }), "Stored links must agree with current catalog matching");
  }
  const sample = products.find(product => product.payload.vehicles.length > 1);
  assert.ok(sample);
  const original = (await client.query("SELECT source_index,vehicle_type_id,match_status FROM product_vehicle_fitments WHERE supplier_item_id=$1 ORDER BY source_index", [sample.supplier_item_id])).rows;
  await syncProductFitments(client, sample.supplier_item_id, sample.payload, matcher);
  await syncProductFitments(client, sample.supplier_item_id, sample.payload, matcher);
  assert.deepEqual((await client.query("SELECT source_index,vehicle_type_id,match_status FROM product_vehicle_fitments WHERE supplier_item_id=$1 ORDER BY source_index", [sample.supplier_item_id])).rows, original, "Repeated import is idempotent");
  await syncProductFitments(client, sample.supplier_item_id, { ...sample.payload, vehicles: sample.payload.vehicles.slice(0, 1) }, matcher);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM product_vehicle_fitments WHERE supplier_item_id=$1", [sample.supplier_item_id])).rows[0].count, 1, "Replacement removes old observations");
  await syncProductFitments(client, sample.supplier_item_id, { ...sample.payload, vehicles: [] }, matcher);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM product_vehicle_fitments WHERE supplier_item_id=$1", [sample.supplier_item_id])).rows[0].count, 0);
  await client.query("ROLLBACK");
  const response = await fetch(`${process.env.VERIFY_URL || "http://localhost:3000"}/urun/0000df72-b78a-4fca-92ec-700be2e7baf2`);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes("Kataloğa bağlı"));
  console.log(JSON.stringify({ verifiedProducts: products.length, sourceRows: expected, summary, repeatedImport: "passed", replacement: "passed", detail: "passed", testWrites: "rolled back" }, null, 2));
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
