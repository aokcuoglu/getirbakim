import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { bundleItems, referencedItemIds, resolveBundleItems } from "./storefront-bundle-items";

test("referenced ids cover enrichments, mappings and logo evidence once each", () => {
  assert.deepEqual(referencedItemIds({
    enrichments: [{ supplier_item_id: "a" }, { supplier_item_id: "b" }], products: [{ supplier_item_id: "a" }],
    logos: [{ evidence_product_id: "c" }, { evidence_product_id: null }],
  }), ["a", "b", "c"]);
});

test("a bundle without items falls back to its ids", () => {
  assert.deepEqual(bundleItems({ enrichments: [{ supplier_item_id: "a" }] }), [{ id: "a" }]);
  const items = [{ id: "a", supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: "X" }];
  assert.equal(bundleItems({ items, enrichments: [{ supplier_item_id: "a" }] }), items);
});

test("PostgreSQL: bundle items resolve by supplier key first, then by id", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL });
  const namespace = `storefront_items_test_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${namespace}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace}` });
  const client = await pool.connect();
  try {
    await client.query(await readFile("db/schema.sql", "utf8"));
    const key = (code: string) => ({ supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code });
    const insert = async (id: string, code: string) => client.query(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
      VALUES($1,'basbug','C','L','MRK',$2,'{}',1,0,0,now(),now(),now())`, [id, code]);
    const same = randomUUID(), localNew = randomUUID(), remoteNew = randomUUID(), legacy = randomUUID();
    await insert(same, "SAME");
    await insert(localNew, "NEW"); // Listed here after the cutover: same product, another uuid.
    await insert(legacy, "LEGACY");

    await client.query("BEGIN");
    const report = await resolveBundleItems(client, [
      { id: same, ...key("SAME") }, { id: remoteNew, ...key("NEW") }, { id: randomUUID(), ...key("GONE") }, { id: legacy },
    ]);
    assert.deepEqual(report, { items: 4, rekeyed: 1, missing: 1 });
    const { rows } = await client.query<{ bundle_id: string; id: string | null }>("SELECT bundle_id,id FROM bundle_items");
    const resolved = new Map(rows.map(row => [row.bundle_id, row.id]));
    assert.equal(resolved.get(same), same);
    assert.equal(resolved.get(remoteNew), localNew);
    assert.equal(resolved.get(legacy), legacy);
    assert.equal(rows.filter(row => row.id === null).length, 1);
    await client.query("ROLLBACK");
  } finally {
    client.release(); await pool.end(); await root.query(`DROP SCHEMA ${namespace} CASCADE`); await root.end();
  }
});
