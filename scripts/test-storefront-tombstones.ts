import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import type { PoolClient } from "pg";
import { isolatedSchema } from "./isolated-schema";
import { resolveBundleItems } from "./storefront-bundle-items";
import {
  applyBundleTombstones, exportTombstones, MANUAL_SOURCE_METHOD, pruneTombstones, REMOVED_JOB_ERROR, TOMBSTONE_RETENTION_DAYS, type Tombstone,
} from "./storefront-bundle-tombstones";
import { manualSourceMethod } from "../src/modules/suppliers/manual-import";

// Deleted and invalidated enrichments in the storefront sync (#564), in an isolated copy of the schema: what
// db/enrichment-tombstones.sql logs, what the export carries and what the import deletes on the target.
const skip = !process.env.DATABASE_URL && "DATABASE_URL not set";
let schema: Awaited<ReturnType<typeof isolatedSchema>> | undefined;
let client: PoolClient;

const key = (code: string) => ({ supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code });
async function item(code: string, id = randomUUID()) {
  await client.query(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
    VALUES($1,'basbug','C','L','MRK',$2,'{}',1,0,0,now(),now(),now())`, [id, code]);
  return id;
}
async function enrich(id: string, { method = "trodo", importedAt = "2026-11-01T00:00:00Z", status = "complete" as string | null } = {}) {
  await client.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,imported_at)
    VALUES($1,'X','FEBI','https://www.trodo.com/x',$2,'FEBI','1','{}',$3)`, [id, method, importedAt]);
  if (status) await client.query("INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,'X','FEBI',$2)", [id, status]);
}
const logged = async () => (await client.query<{ supplier_item_id: string; code: string; kind: string; source_method: string | null }>(
  "SELECT supplier_item_id::text,code,kind,source_method FROM product_enrichment_tombstones ORDER BY id")).rows;
const exported = async (all = false) => (await exportTombstones(client, all)).map(row => ({ code: row.code, kind: row.kind }));

before(async () => {
  if (skip) return;
  schema = await isolatedSchema("storefront_tombstones_test");
  client = await schema.pool.connect();
  for (const [source, id] of [["trodo", 1], ["otoparcasan", 9]] as const) {
    await client.query(`INSERT INTO source_categories(source,category_id,name,slug,path_ids,source_url,raw) VALUES($1,$2,'n','s','{}','u','{}')`, [source, id]);
  }
});
after(async () => { client?.release(); await schema?.drop(); });
beforeEach(async () => { if (!skip) await client.query("DELETE FROM product_enrichment_tombstones"); });

test("the bundle scripts' manual source method is the manual import's", () => {
  assert.equal(MANUAL_SOURCE_METHOD, manualSourceMethod);
});

test("PostgreSQL: deletions and jobs leaving complete/partial are logged with the natural key; cascades are not", { skip }, async () => {
  const deleted = await item("T-DELETED"), reset = await item("T-RESET"), dropped = await item("T-DROPPED"), failed = await item("T-FAILED"), gone = await item("T-GONE");
  await enrich(deleted, { method: "spareto" });
  await enrich(reset, { method: "otoparcasan" });
  await enrich(dropped, { status: "partial" });
  await enrich(failed, { status: "pending" });
  await enrich(gone);

  await client.query("DELETE FROM product_enrichments WHERE supplier_item_id=$1", [deleted]);
  await client.query("UPDATE product_enrichment_jobs SET status='pending' WHERE supplier_item_id=$1", [reset]);
  await client.query("DELETE FROM product_enrichment_jobs WHERE supplier_item_id=$1", [dropped]);
  // Neither leaves complete/partial: nothing is logged.
  await client.query("UPDATE product_enrichment_jobs SET status='failed' WHERE supplier_item_id=$1", [failed]);
  await client.query("UPDATE product_enrichment_jobs SET status='partial' WHERE supplier_item_id=$1", [gone]);
  // The supplier item goes, its enrichment and job cascade: the parent is invisible to the trigger, nothing is logged.
  await client.query("DELETE FROM supplier_items WHERE id=$1", [gone]);
  assert.equal((await client.query("SELECT 1 FROM product_enrichments WHERE supplier_item_id=$1", [gone])).rowCount, 0);

  assert.deepEqual(await logged(), [
    { supplier_item_id: deleted, code: "T-DELETED", kind: "enrichment_deleted", source_method: "spareto" },
    { supplier_item_id: reset, code: "T-RESET", kind: "job_invalidated", source_method: "otoparcasan" },
    { supplier_item_id: dropped, code: "T-DROPPED", kind: "job_invalidated", source_method: "trodo" },
  ]);
  const row = (await client.query("SELECT supplier,company,list_group,warehouse FROM product_enrichment_tombstones WHERE supplier_item_id=$1", [deleted])).rows[0];
  assert.deepEqual(row, { supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK" });
});

test("PostgreSQL: the export carries the latest entry per item, its kind from the current state, without manual uploads or old entries", { skip }, async () => {
  const deleted = await item("E-DELETED"), invalid = await item("E-INVALID"), both = await item("E-BOTH"), again = await item("E-AGAIN");
  const manual = await item("E-MANUAL"), old = await item("E-OLD"), recreated = await item("E-RECREATED");
  for (const id of [deleted, invalid, both, again, old, recreated]) await enrich(id);
  await enrich(manual, { method: MANUAL_SOURCE_METHOD });

  await client.query("DELETE FROM product_enrichments WHERE supplier_item_id=ANY($1::uuid[])", [[deleted, manual, old]]);
  await client.query("UPDATE product_enrichment_jobs SET status='pending' WHERE supplier_item_id=ANY($1::uuid[])", [[invalid, both, again]]);
  // Invalidated, then deleted: the item has no enrichment now.
  await client.query("DELETE FROM product_enrichments WHERE supplier_item_id=$1", [both]);
  // Enriched again and valid: no longer a deletion.
  await client.query("UPDATE product_enrichment_jobs SET status='complete' WHERE supplier_item_id=$1", [again]);
  await client.query("UPDATE product_enrichment_tombstones SET recorded_at=now()-make_interval(days => $2) WHERE supplier_item_id=$1", [old, TOMBSTONE_RETENTION_DAYS + 1]);
  // Deleted, then the supplier item came back under another id with a valid enrichment (found by natural key).
  await client.query("DELETE FROM product_enrichments WHERE supplier_item_id=$1", [recreated]);
  await client.query("DELETE FROM supplier_items WHERE id=$1", [recreated]);
  await enrich(await item("E-RECREATED"));

  assert.deepEqual((await exported()).sort((a, b) => a.code.localeCompare(b.code)), [
    { code: "E-BOTH", kind: "enrichment_deleted" }, { code: "E-DELETED", kind: "enrichment_deleted" }, { code: "E-INVALID", kind: "job_invalidated" },
  ]);
  // Without the window (a --full run) the old entry goes too.
  assert.ok((await exported(true)).some(row => row.code === "E-OLD"));
  const [row] = (await exportTombstones(client, false)).filter(tombstone => tombstone.supplier_item_id === deleted);
  assert.deepEqual({ ...key("E-DELETED"), source_method: "trodo" },
    { supplier: row.supplier, company: row.company, list_group: row.list_group, warehouse: row.warehouse, code: row.code, source_method: row.source_method });
});

test("PostgreSQL: the target deletes by natural key, keeps newer and manual data, and resets the job", { skip }, async () => {
  // The target's ids differ from the bundle's (supplier items listed on each side separately).
  const removed = await item("A-REMOVED"), newer = await item("A-NEWER"), manual = await item("A-MANUAL"), invalid = await item("A-INVALID");
  await enrich(removed);
  await enrich(newer, { importedAt: "2026-11-12T00:00:00Z" });
  await enrich(manual, { method: MANUAL_SOURCE_METHOD });
  await enrich(invalid);
  for (const [source, category] of [["trodo", 1], ["otoparcasan", 9]] as const) {
    await client.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,$2,$3)", [removed, source, category]);
  }
  await client.query(`INSERT INTO product_vehicle_fitments(supplier_item_id,source_index,source_vehicle,match_status,matcher_version)
    VALUES($1,0,'{}','model_missing','test')`, [removed]);
  await client.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,imported_at)
    VALUES($1,'X','FEBI',$1,'','complete',now())`, [removed]);

  const tombstone = (code: string, kind: Tombstone["kind"] = "enrichment_deleted", recordedAt = "2026-11-10T00:00:00Z"): Tombstone =>
    ({ supplier_item_id: randomUUID(), ...key(code), kind, source_method: "trodo", recorded_at: recordedAt });
  const tombstones = [tombstone("A-REMOVED"), tombstone("A-NEWER"), tombstone("A-MANUAL"), tombstone("A-UNKNOWN"),
    tombstone("A-INVALID", "job_invalidated", new Date(Date.now() + 60_000).toISOString())];
  const apply = async (options: Parameters<typeof applyBundleTombstones>[3] = {}) => {
    await client.query("BEGIN");
    try {
      await resolveBundleItems(client, tombstones.map(({ supplier_item_id: id, supplier, company, list_group, warehouse, code }) => ({ id, supplier, company, list_group, warehouse, code })));
      const result = await applyBundleTombstones(client, tombstones, ["trodo"], options);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  };

  // More deletions than the cap: nothing is applied.
  await assert.rejects(apply({ maxDeletions: 0 }), /would delete 1 enrichments, more than --max-deletions=0/);
  assert.equal((await client.query("SELECT 1 FROM product_enrichments WHERE supplier_item_id=$1", [removed])).rowCount, 1);

  assert.deepEqual(await apply(), { tombstones: 5, removedEnrichments: 1, removedMappings: 1, resetJobs: 1, invalidatedJobsReported: 1, tombstonesKept: 3 });
  const remaining = async (table: string, column = "supplier_item_id") =>
    (await client.query(`SELECT ${column}::text AS id FROM ${table} WHERE ${column}=ANY($1::uuid[]) ORDER BY 1`, [[removed, newer, manual, invalid]])).rows.map(row => row.id);
  assert.deepEqual(await remaining("product_enrichments"), [newer, manual, invalid].sort());
  assert.deepEqual(await remaining("product_vehicle_fitments"), []);
  assert.deepEqual(await remaining("product_enrichment_shared_links", "donor_item_id"), []);
  assert.deepEqual((await client.query("SELECT source,category_id FROM product_source_categories WHERE supplier_item_id=$1", [removed])).rows, [{ source: "otoparcasan", category_id: 9 }]);
  const job = async (id: string) => (await client.query<{ status: string; last_error: string | null }>("SELECT status,last_error FROM product_enrichment_jobs WHERE supplier_item_id=$1", [id])).rows[0];
  assert.deepEqual(await job(removed), { status: "pending", last_error: REMOVED_JOB_ERROR });
  // job_invalidated is only reported.
  assert.deepEqual(await job(invalid), { status: "complete", last_error: null });

  // The same bundle again changes nothing.
  assert.deepEqual(await apply(), { tombstones: 5, removedEnrichments: 0, removedMappings: 0, resetJobs: 0, invalidatedJobsReported: 1, tombstonesKept: 4 });
  // The switch that applies job_invalidated as well.
  assert.equal((await apply({ invalidateJobs: true })).resetJobs, 1);
  assert.deepEqual(await job(invalid), { status: "pending", last_error: REMOVED_JOB_ERROR });
});

test("PostgreSQL: entries past the retention are pruned; a database without the log is left alone", { skip }, async () => {
  const kept = await item("P-KEPT"), old = await item("P-OLD");
  await enrich(kept);
  await enrich(old);
  await client.query("DELETE FROM product_enrichments WHERE supplier_item_id=ANY($1::uuid[])", [[kept, old]]);
  await client.query("UPDATE product_enrichment_tombstones SET recorded_at=now()-make_interval(days => $2) WHERE supplier_item_id=$1", [old, TOMBSTONE_RETENTION_DAYS + 1]);
  assert.equal(await pruneTombstones(client), 1);
  assert.deepEqual((await logged()).map(row => row.supplier_item_id), [kept]);

  await client.query("BEGIN");
  await client.query("DROP TABLE product_enrichment_tombstones CASCADE");
  assert.equal(await pruneTombstones(client), 0);
  await client.query("ROLLBACK");
});
