import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { syncProductStates } from "./test-helpers/product-states";
import { enqueueProductSources } from "../src/modules/enrichment/product-queue";
import { pendingChunkSql, pendingOrderSql, pendingSuppliers, type PendingSupplier } from "../src/modules/enrichment/pending-queue";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// spareto's pending selection (#921), in an isolated copy of the schema: the order comes from the materialized
// enrichment_product_states as ids only, details are read in small chunks that re-check the state, and the ids
// searched before never travel to the database.
const skip = !process.env.DATABASE_URL;
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();

/** One supplier row, its own master product: in stock and saleable, saleable without stock, or (later) not offered. */
async function item(key: string, tier: "stock" | "store" | "absent") {
  const code = `${key.toUpperCase()} 1000`;
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G',$2,$3,$4,'{"nf":100}',$5,1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [basbug, "MRK", code, { uk: key.toUpperCase(), ac: `${key} PARCA` }, { stok: tier === "stock" ? 2 : 0 }]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const keyOf = (id: string) => Object.keys(ids).find((key) => ids[key] === id);
async function collect(tried: Set<string>, limit: number, options?: { chunk?: number; reorderEvery?: number }, onRow?: (row: PendingSupplier) => Promise<void>) {
  const rows: PendingSupplier[] = [];
  for await (const row of pendingSuppliers(schema.pool, tried, limit, options)) { rows.push(row); await onRow?.(row); }
  return rows;
}

before(async () => {
  if (skip) return;
  schema = await isolatedSchema("enrichment_pending_test");
  for (const key of ["absenta", "absentb", "storea", "storeb", "stocka", "stockb", "stockc"])
    await item(key, key.startsWith("absent") ? "absent" : key.startsWith("store") ? "store" : "stock");
  await schema.pool.query("SELECT refresh_product_matches()");
  // Matched while saleable, then no longer offered (another warehouse): the product stays in the catalog.
  await schema.pool.query("UPDATE supplier_items SET warehouse='IST' WHERE id=ANY($1::uuid[])", [[ids.absenta, ids.absentb]]);
  await enqueueProductSources(schema.pool);
  await syncProductStates(schema.pool);
});
after(async () => { await schema?.drop(); });

test("pending products come in stock tiers: in stock, saleable, then no longer offered", { skip }, async () => {
  const rows = await collect(new Set(), 100);
  assert.deepEqual(rows.map((row) => keyOf(row.id)?.replace(/[abc]$/, "")),
    ["stock", "stock", "stock", "store", "store", "absent", "absent"]);
  const first = rows[0];
  assert.equal(first.code, `${keyOf(first.id)!.toUpperCase()} 1000`);
  assert.equal(first.brand, keyOf(first.id)!.toUpperCase());
  assert.equal(first.oem, "");
});

test("the limit is respected and the tried ids stay out of every query", { skip }, async (t) => {
  const query = t.mock.method(schema.pool, "query");
  const tried = new Set([ids.stocka, ...Array.from({ length: 500 }, () => randomUUID())]);
  const rows = await collect(tried, 3, { chunk: 2 });
  assert.equal(rows.length, 3);
  assert.ok(!rows.some((row) => row.id === ids.stocka), "a tried id is not searched again");
  assert.deepEqual(rows.slice(0, 2).map((row) => keyOf(row.id)?.replace(/[abc]$/, "")), ["stock", "stock"]);
  for (const row of rows) assert.ok(tried.has(row.id), "every yielded id joins the tried set");
  const largest = Math.max(0, ...query.mock.calls.flatMap((call) => (call.arguments[1] as unknown[] | undefined ?? [])
    .map((value) => Array.isArray(value) ? value.length : 0)));
  assert.ok(largest <= 2, `no query parameter holds more than a chunk of ids (largest ${largest})`);
});

test("a product finished between the order and its chunk is not searched", { skip }, async () => {
  const seen: string[] = [];
  const rows = await collect(new Set(), 100, { chunk: 1 }, async (row) => {
    seen.push(row.id);
    if (seen.length === 1) {
      // Another source finishes every other stocked product while the first one is searched.
      await schema.pool.query("UPDATE product_enrichment_jobs SET status='not_found',updated_at=now() WHERE supplier_item_id=ANY($1::uuid[]) AND supplier_item_id<>$2",
        [[ids.stocka, ids.stockb, ids.stockc], row.id]);
    }
  });
  assert.equal(rows.filter((row) => keyOf(row.id)?.startsWith("stock")).length, 1);
  assert.equal(rows.length, 5);
  await schema.pool.query("UPDATE product_enrichment_jobs SET status='pending',updated_at=now()");
});

test("a product in an unfinished Trodo run is left to it", { skip }, async () => {
  const run = (await schema.pool.query<{ id: string }>("INSERT INTO enrichment_runs(seed,sample_size,status) VALUES('test',1,'running') RETURNING id::text")).rows[0].id;
  await schema.pool.query(`INSERT INTO enrichment_run_items(run_id,product_id,supplier_item_id,ordinal,supplier_code,supplier_brand,oem)
    SELECT $1,$2,id,0,code,product_data->>'uk','' FROM supplier_items WHERE id=$3`, [run, await productOf("storea"), ids.storea]);
  try {
    const rows = await collect(new Set(), 100);
    assert.equal(rows.length, 6);
    assert.ok(!rows.some((row) => row.id === ids.storea));
    await schema.pool.query("UPDATE enrichment_runs SET status='complete' WHERE id=$1", [run]);
    assert.ok((await collect(new Set(), 100)).some((row) => row.id === ids.storea), "a finished run gives the product back");
  } finally {
    await schema.pool.query("DELETE FROM enrichment_run_items WHERE run_id=$1", [run]);
    await schema.pool.query("DELETE FROM enrichment_runs WHERE id=$1", [run]);
  }
});

test("the order is read again every reorderEvery products and covers every pending product once", { skip }, async (t) => {
  const query = t.mock.method(schema.pool, "query");
  const rows = await collect(new Set(), 100, { reorderEvery: 2 });
  assert.equal(rows.length, 7);
  assert.equal(new Set(rows.map((row) => row.id)).size, 7);
  assert.deepEqual(rows.map((row) => keyOf(row.id)?.replace(/[abc]$/, "")),
    ["stock", "stock", "stock", "store", "store", "absent", "absent"]);
  // Four rounds of at most two products, then one that finds nothing left.
  assert.equal(query.mock.calls.filter((call) => call.arguments[0] === pendingOrderSql).length, 5);
});

test("an order list that is all tried ends the selection at once", { skip }, async (t) => {
  const query = t.mock.method(schema.pool, "query");
  const rows = await collect(new Set(Object.values(ids)), 100);
  assert.deepEqual(rows, []);
  assert.equal(query.mock.calls.filter((call) => call.arguments[0] === pendingOrderSql).length, 1);
  assert.equal(query.mock.calls.filter((call) => call.arguments[0] === pendingChunkSql).length, 0);
});

test("a job finished while the state sync is held off is not searched", { skip }, async () => {
  // Another session holds the sync lock (as refresh_product_matches does): the states row stays pending.
  const holder = await schema.pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT pg_advisory_xact_lock(20261001,schema_lock_key(5))");
    await schema.pool.query("UPDATE product_enrichment_jobs SET status='complete',updated_at=now() WHERE supplier_item_id=$1", [ids.stocka]);
    const rows = await collect(new Set(), 100);
    assert.equal(rows.length, 6);
    assert.ok(!rows.some((row) => row.id === ids.stocka), "the item's own job is no longer open");
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
    await schema.pool.query("UPDATE product_enrichment_jobs SET status='pending',updated_at=now()");
  }
});
