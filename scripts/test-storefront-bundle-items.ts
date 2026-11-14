import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { bundleItems, referencedItemIds, resolveBundleItems } from "./storefront-bundle-items";
import { EXPORTED_ENRICHMENT_IDS } from "./storefront-bundle-export";
import { importBundleJobs } from "./storefront-bundle-jobs";
import { replaceBundleMappings } from "./storefront-bundle-mappings";

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

function sharedQueueSql(sql: string) {
  const slice = (start: string, end: string, inclusive = true) => {
    const from = sql.indexOf(start), to = sql.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `${start} not found in db/enrichment-shared-links.sql`);
    return sql.slice(from, inclusive ? to + end.length : to);
  };
  return [
    slice("CREATE TABLE IF NOT EXISTS product_enrichment_shared_queue", ");"),
    slice("CREATE OR REPLACE FUNCTION product_enrichment_shared_queue_items()", "END $$;"),
    slice("DROP TRIGGER IF EXISTS enrichment_shared_jobs_insert", "DROP TRIGGER IF EXISTS enrichment_shared_enrichments_insert", false),
  ].join("\n");
}

async function withSchema(name: string, files: string[], body: (client: PoolClient) => Promise<void>) {
  const root = new Pool({ connectionString: process.env.DATABASE_URL });
  const namespace = `${name}_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${namespace}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace}` });
  const client = await pool.connect();
  try {
    for (const file of files) await client.query(await readFile(file, "utf8"));
    await body(client);
  } finally {
    client.release(); await pool.end(); await root.query(`DROP SCHEMA ${namespace} CASCADE`); await root.end();
  }
}

const itemKey = (code: string) => ({ supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code });
async function insertItem(client: PoolClient, id: string, code: string) {
  await client.query(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
    VALUES($1,'basbug','C','L','MRK',$2,'{}',1,0,0,now(),now(),now())`, [id, code]);
}
async function insertEnrichment(client: PoolClient, id: string, importedAt: string) {
  await client.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,imported_at)
    VALUES($1,'X','FEBI','https://www.trodo.com/x','test','FEBI','1','{}',$2)`, [id, importedAt]);
}
const enrichmentFiles = ["db/schema.sql", "db/product-enrichment.sql", "db/source-categories.sql"];

test("PostgreSQL: a bundle replaces the category mappings of its enrichments, for its sources only", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  await withSchema("storefront_mappings_test", enrichmentFiles, async client => {
    for (const [source, id] of [["trodo", 1], ["trodo", 2], ["trodo", 3], ["otoparcasan", 9]] as const) {
      await client.query(`INSERT INTO source_categories(source,category_id,name,slug,path_ids,source_url,raw) VALUES($1,$2,'n','s','{}','u','{}')`, [source, id]);
    }
    const changed = randomUUID(), untouched = randomUUID(), unknown = randomUUID();
    await insertItem(client, changed, "CHANGED");
    await insertItem(client, untouched, "UNTOUCHED");
    for (const [item, source, category] of [[changed, "trodo", 1], [changed, "trodo", 2], [changed, "otoparcasan", 9], [untouched, "trodo", 1]] as const) {
      await client.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,$2,$3)", [item, source, category]);
    }
    await client.query("BEGIN");
    await resolveBundleItems(client, [{ id: changed }, { id: unknown }]);
    const result = await replaceBundleMappings(client, {
      categories: [{ source: "trodo", category_id: 1 }],
      enrichments: [{ supplier_item_id: changed }, { supplier_item_id: unknown }],
      products: [{ supplier_item_id: changed, source: "trodo", category_id: 2 }, { supplier_item_id: changed, source: "trodo", category_id: 3 },
        { supplier_item_id: unknown, source: "trodo", category_id: 1 }],
    });
    await client.query("COMMIT");
    assert.deepEqual(result, { removed: 2, inserted: 2 });
    const { rows } = await client.query<{ supplier_item_id: string; source: string; category_id: number }>(
      "SELECT supplier_item_id,source,category_id FROM product_source_categories ORDER BY supplier_item_id,source,category_id");
    const mapped = (id: string) => rows.filter(row => row.supplier_item_id === id).map(row => `${row.source}:${row.category_id}`);
    assert.deepEqual(mapped(changed), ["otoparcasan:9", "trodo:2", "trodo:3"]);
    assert.deepEqual(mapped(untouched), ["trodo:1"]);
  });
});

test("PostgreSQL: an export carries enrichments after the watermark and the retried supplier items", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  await withSchema("storefront_export_test", enrichmentFiles, async client => {
    const old = randomUUID(), fresh = randomUUID(), byId = randomUUID(), byKey = randomUUID();
    for (const [id, code] of [[old, "OLD"], [fresh, "FRESH"], [byId, "BYID"], [byKey, "BYKEY"]]) await insertItem(client, id, code);
    for (const id of [old, byId, byKey]) await insertEnrichment(client, id, "2026-11-01T00:00:00Z");
    await insertEnrichment(client, fresh, "2026-11-14T00:00:00Z");
    const exported = async (retry: unknown[]) => (await client.query<{ supplier_item_id: string }>(
      `SELECT supplier_item_id FROM (${EXPORTED_ENRICHMENT_IDS}) x ORDER BY 1`, [new Date("2026-11-13T00:00:00Z"), JSON.stringify(retry)])).rows.map(row => row.supplier_item_id);
    assert.deepEqual(await exported([]), [fresh]);
    // The second retry item was re-created locally under another id; its natural key still finds it.
    assert.deepEqual(await exported([{ id: byId }, { id: randomUUID(), ...itemKey("BYKEY") }, { id: randomUUID(), ...itemKey("GONE") }]), [fresh, byId, byKey].sort());
  });
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
    // Only the shared-link queue and its job triggers: the whole file needs the master catalog, brands and views.
    await client.query(sharedQueueSql(await readFile("db/enrichment-shared-links.sql", "utf8")));
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
    const queued = async () => (await client.query<{ id: string }>("SELECT id FROM product_enrichment_shared_queue WHERE kind='i' ORDER BY id")).rows.map(row => row.id);
    assert.deepEqual(await queued(), [fresh, pending].sort());
    await client.query("DELETE FROM product_enrichment_shared_queue");

    // The same bundle again changes nothing, so the statement triggers queue nothing.
    await client.query("BEGIN");
    await resolveBundleItems(client, items);
    assert.deepEqual(await importBundleJobs(client, jobs), { jobs: 0, skipped: 1 });
    assert.deepEqual(await queued(), []);
    await client.query("ROLLBACK");
  } finally {
    client.release(); await pool.end(); await root.query(`DROP SCHEMA ${namespace} CASCADE`); await root.end();
  }
});
