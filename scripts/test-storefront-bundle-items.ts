import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { bundleItems, referencedItemIds, resolveBundleItems } from "./storefront-bundle-items";
import { importBundleJobs } from "./storefront-bundle-jobs";

test("referenced ids cover enrichments, mappings, logo evidence and jobs once each", () => {
  assert.deepEqual(referencedItemIds({
    enrichments: [{ supplier_item_id: "a" }, { supplier_item_id: "b" }], products: [{ supplier_item_id: "a" }],
    logos: [{ evidence_product_id: "c" }, { evidence_product_id: null }], jobs: [{ supplier_item_id: "b" }, { supplier_item_id: "d" }],
  }), ["a", "b", "c", "d"]);
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

test("PostgreSQL: bundle jobs write only changed statuses and skip unknown products", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL });
  const namespace = `storefront_jobs_test_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${namespace}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace}` });
  const client = await pool.connect();
  try {
    await client.query(await readFile("db/schema.sql", "utf8"));
    await client.query(await readFile("db/product-enrichment.sql", "utf8"));
    const pending = randomUUID(), fresh = randomUUID(), gone = randomUUID();
    for (const [id, code] of [[pending, "PENDING"], [fresh, "FRESH"]]) {
      await client.query(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
        VALUES($1,'basbug','C','L','MRK',$2,'{}',1,0,0,now(),now(),now())`, [id, code]);
    }
    await client.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status,attempts,last_error)
      VALUES($1,'PENDING','FEBI','pending',0,'timeout')`, [pending]);
    const job = (id: string, code: string, status: string) => ({
      supplier_item_id: id, supplier_code: code, supplier_brand: "FEBI", oem: "", status, candidate_url: `https://www.trodo.com/${code}`, last_attempt_at: "2026-11-13T00:00:00Z",
    });
    const jobs = [job(pending, "PENDING", "complete"), job(fresh, "FRESH", "partial"), job(gone, "GONE", "complete")];
    const items = [{ id: pending }, { id: fresh }, { id: gone }];

    await client.query("BEGIN");
    await resolveBundleItems(client, items);
    assert.deepEqual(await importBundleJobs(client, jobs), { jobs: 2, skipped: 1 });
    await client.query("COMMIT");
    const { rows } = await client.query<{ supplier_item_id: string; status: string; last_error: string | null; candidate_url: string }>(
      "SELECT supplier_item_id,status,last_error,candidate_url FROM product_enrichment_jobs ORDER BY supplier_code");
    assert.deepEqual(rows.map(row => [row.supplier_item_id, row.status, row.last_error]), [[fresh, "partial", null], [pending, "complete", null]]);
    assert.equal(rows[1].candidate_url, "https://www.trodo.com/PENDING");

    // The same bundle again changes nothing, so the statement triggers queue nothing.
    await client.query("BEGIN");
    await resolveBundleItems(client, items);
    assert.deepEqual(await importBundleJobs(client, jobs), { jobs: 0, skipped: 1 });
    await client.query("ROLLBACK");
  } finally {
    client.release(); await pool.end(); await root.query(`DROP SCHEMA ${namespace} CASCADE`); await root.end();
  }
});
