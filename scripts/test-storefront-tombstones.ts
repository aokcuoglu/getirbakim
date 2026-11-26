import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { PoolClient } from "pg";
import { isolatedSchema } from "./isolated-schema";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { resolveBundleItems } from "./storefront-bundle-items";
import { ENRICHMENTS_FILE, ITEMS_FILE, JOBS_FILE, MEDIA_FILE, PRODUCTS_FILE, writeNdjson } from "./storefront-bundle-stream";
import { buildInboundReport, type PartReport } from "./storefront-sync-state";
import {
  applyBundleTombstones, bundleTombstones, exportTombstones, MANUAL_SOURCE_METHOD, pruneTombstones, REMOVED_JOB_ERROR, TOMBSTONE_RETENTION_DAYS, type Tombstone,
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
  const invalidGone = await item("E-INVALID-GONE"), deletedGone = await item("E-DELETED-GONE");
  for (const id of [deleted, invalid, both, again, old, recreated, invalidGone, deletedGone]) await enrich(id);
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
  // The supplier item went after its job was invalidated: the enrichment cascaded, which is no deletion to repeat.
  await client.query("UPDATE product_enrichment_jobs SET status='pending' WHERE supplier_item_id=$1", [invalidGone]);
  await client.query("DELETE FROM product_enrichments WHERE supplier_item_id=$1", [deletedGone]);
  await client.query("DELETE FROM supplier_items WHERE id=ANY($1::uuid[])", [[invalidGone, deletedGone]]);

  assert.deepEqual((await exported()).sort((a, b) => a.code.localeCompare(b.code)), [
    { code: "E-BOTH", kind: "enrichment_deleted" }, { code: "E-DELETED", kind: "enrichment_deleted" }, { code: "E-DELETED-GONE", kind: "enrichment_deleted" },
    { code: "E-INVALID", kind: "job_invalidated" }, { code: "E-INVALID-GONE", kind: "job_invalidated" },
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

test("job_invalidated entries travel as a count while the target only reports them", () => {
  const row = (kind: Tombstone["kind"]): Tombstone => ({ supplier_item_id: randomUUID(), ...key("B"), kind, source_method: null, recorded_at: "2026-11-10T00:00:00Z" });
  const rows = [row("enrichment_deleted"), row("job_invalidated"), row("job_invalidated")];
  assert.deepEqual(bundleTombstones(rows, false), { tombstones: [rows[0]], invalidatedJobs: 2 });
  assert.deepEqual(bundleTombstones(rows, true), { tombstones: rows, invalidatedJobs: 0 });
});

test("PostgreSQL: import-storefront-bundle applies tombstones before the part's jobs and enrichments, stops above the cap even in a dry run", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "storefront-tombstones-"));
  try {
    // Target ids differ from the bundle's.
    const removed = await item("I-REMOVED"), added = await item("I-ADDED");
    await enrich(removed);
    const bundleRemoved = randomUUID(), bundleAdded = randomUUID();
    const enrichment = { supplier_item_id: bundleAdded, supplier_code: "X", supplier_brand: "FEBI", source_url: "https://www.trodo.com/y", source_method: "trodo",
      manufacturer: "FEBI", manufacturer_part_number: "2", image_id: null, payload: {}, imported_at: "2026-11-11T00:00:00Z", match_basis: { type: "exact_part" } };
    const manifest = (maxDeletions: number) => ({
      snapshotAt: "2026-11-12T00:00:00Z", categories: [], labels: [], images: [], logos: [], vehicleSpecs: [], vehicleImages: [], media: [], products: [],
      enrichments: [enrichment],
      jobs: [{ supplier_item_id: bundleAdded, supplier_code: "X", supplier_brand: "FEBI", oem: "", status: "complete", candidate_url: null, last_attempt_at: "2026-11-11T00:00:00Z" }],
      tombstones: [{ supplier_item_id: bundleRemoved, ...key("I-REMOVED"), kind: "enrichment_deleted", source_method: "trodo", recorded_at: "2026-11-10T00:00:00Z" }],
      invalidatedJobs: 2, maxDeletions,
      items: [{ id: bundleRemoved, ...key("I-REMOVED") }, { id: bundleAdded, ...key("I-ADDED") }],
    });
    const run = async (maxDeletions: number, args: string[] = []) => {
      await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest(maxDeletions)));
      return spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/import-storefront-bundle.ts", dir, ...args],
        { encoding: "utf8", env: { ...process.env, S3_BUCKET: "test-media", S3_REGION: process.env.S3_REGION || "eu-central-1" } });
    };
    const has = async (id: string) => (await client.query("SELECT 1 FROM product_enrichments WHERE supplier_item_id=$1", [id])).rowCount === 1;

    // Above the cap: a dry run fails (the inbound task dry-runs every part first), nothing is written.
    const capped = await run(0);
    assert.notEqual(capped.status, 0);
    assert.match(capped.stderr, /would delete 1 enrichments, more than --max-deletions=0/);
    assert.equal(await has(removed), true);
    const dry = await run(1000);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /DRY RUN/);
    assert.deepEqual([await has(removed), await has(added)], [true, false]);

    const reportFile = join(dir, "report.json");
    const applied = await run(1000, ["--apply", `--report=${reportFile}`]);
    assert.equal(applied.status, 0, applied.stderr);
    const { report, items } = JSON.parse(await readFile(reportFile, "utf8")) as { report: Record<string, number>; items: string[] };
    assert.deepEqual(
      [report.tombstones, report.removedEnrichments, report.resetJobs, report.invalidatedJobsReported, report.tombstonesKept, report.enrichments, report.jobs],
      [1, 1, 1, 2, 0, 1, 1]);
    assert.deepEqual(items, [added]);
    assert.deepEqual([await has(removed), await has(added)], [false, true]);
    const status = async (id: string) => (await client.query<{ status: string }>("SELECT status FROM product_enrichment_jobs WHERE supplier_item_id=$1", [id])).rows[0].status;
    assert.deepEqual([await status(removed), await status(added)], ["pending", "complete"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("PostgreSQL: job statuses spread over the job parts after part-00 write the same rows as one part with every job (#1317)", { skip }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "storefront-job-parts-"));
  try {
    const codes = ["Q-NEW", "Q-PENDING", "Q-SAME", "Q-PARTIAL", "Q-MISSING", "Q-TOMB", "Q-TOMB-JOB"] as const;
    const bundleId = Object.fromEntries(codes.map(code => [code, randomUUID()])) as Record<(typeof codes)[number], string>;
    const job = (code: (typeof codes)[number], status = "complete") => ({ supplier_item_id: bundleId[code], supplier_code: "X", supplier_brand: "FEBI", oem: "",
      status, candidate_url: null, last_attempt_at: "2026-11-11T00:00:00Z" });
    // As the export orders them. Q-TOMB-JOB has a tombstone and a job, which the export never sends together
    // (EXPORTED_TOMBSTONES leaves out items enriched and valid again): even then part-00's deletion comes first, as it did
    // inside one part.
    const jobs = [job("Q-NEW"), job("Q-PENDING"), job("Q-SAME"), job("Q-PARTIAL", "partial"), job("Q-MISSING"), job("Q-TOMB-JOB")]
      .sort((a, b) => a.supplier_item_id.localeCompare(b.supplier_item_id));
    const tombstone = (code: "Q-TOMB" | "Q-TOMB-JOB") => ({ supplier_item_id: bundleId[code], ...key(code), kind: "enrichment_deleted", source_method: "trodo",
      recorded_at: "2026-11-10T00:00:00Z" });
    const enrichment = { supplier_item_id: bundleId["Q-NEW"], supplier_code: "X", supplier_brand: "FEBI", source_url: "https://www.trodo.com/q", source_method: "trodo",
      manufacturer: "FEBI", manufacturer_part_number: "3", image_id: null, payload: {}, imported_at: "2026-11-11T00:00:00Z", match_basis: { type: "exact_part" } };
    const items = codes.map(code => ({ id: bundleId[code], ...key(code) }));
    const bounded = {
      exportedAt: "2026-11-12T00:00:01Z", since: null, retried: 0, snapshotAt: "2026-11-12T00:00:00Z", categories: [], labels: [], images: [], logos: [],
      vehicleSpecs: [], vehicleImages: [], tombstones: [tombstone("Q-TOMB"), tombstone("Q-TOMB-JOB")], invalidatedJobs: 2, maxDeletions: 1000,
    };

    // The target: ids differ from the bundle's; Q-MISSING is not there. Recreated before each import.
    const seed = async () => {
      await client.query("DELETE FROM supplier_items WHERE code LIKE 'Q-%'");
      await client.query("DELETE FROM product_enrichment_tombstones");
      await item("Q-NEW");
      await enrich(await item("Q-PENDING"), { status: "pending" });
      for (const code of ["Q-SAME", "Q-PARTIAL", "Q-TOMB", "Q-TOMB-JOB"]) await enrich(await item(code));
    };
    const reportFile = join(dir, "report.json");
    const apply = async (part: string) => {
      const result = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/import-storefront-bundle.ts", part, "--apply", `--report=${reportFile}`],
        { encoding: "utf8", env: { ...process.env, S3_BUCKET: "test-media", S3_REGION: process.env.S3_REGION || "eu-central-1" } });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(await readFile(reportFile, "utf8")) as PartReport;
    };
    // product_enrichment_jobs without updated_at, and the enrichments, by supplier code.
    const snapshot = async () => ({
      jobs: (await client.query(`SELECT s.code,j.supplier_code,j.supplier_brand,j.oem,j.status,j.candidate_url,j.attempts,j.last_attempt_at,j.last_error
        FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id WHERE s.code LIKE 'Q-%' ORDER BY s.code`)).rows,
      enrichments: (await client.query(`SELECT s.code,e.source_method,e.imported_at FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
        WHERE s.code LIKE 'Q-%' ORDER BY s.code`)).rows,
    });
    const compared = ["jobs", "skippedJobs", "enrichments", "skippedEnrichments", "tombstones", "removedEnrichments", "resetJobs", "invalidatedJobsReported", "tombstonesKept"];
    const totals = (reports: PartReport[]) => Object.fromEntries(compared.map(name => [name, buildInboundReport(reports).totals[name]]));

    // Before #1317: one part carries every job.
    await seed();
    const legacy = join(dir, "legacy");
    await mkdir(legacy);
    await writeFile(join(legacy, "manifest.json"), JSON.stringify({ ...bounded, products: [], enrichments: [enrichment], media: [], jobs, items }));
    const legacyTotals = totals([await apply(legacy)]);
    const legacyRows = await snapshot();

    // Now: the export's NDJSON files, split with room for two jobs per part.
    await seed();
    const source = join(dir, "full");
    await mkdir(source);
    await writeFile(join(source, "manifest.json"), JSON.stringify({
      ...bounded,
      enrichmentsFile: ENRICHMENTS_FILE, enrichmentCount: await writeNdjson(join(source, ENRICHMENTS_FILE), [enrichment]),
      jobsFile: JOBS_FILE, jobCount: await writeNdjson(join(source, JOBS_FILE), jobs),
      itemsFile: ITEMS_FILE, itemCount: await writeNdjson(join(source, ITEMS_FILE), items),
      productsFile: PRODUCTS_FILE, productCount: await writeNdjson(join(source, PRODUCTS_FILE), []),
      mediaFile: MEDIA_FILE, mediaCount: await writeNdjson(join(source, MEDIA_FILE), []),
    }));
    const size = (row: unknown) => Buffer.byteLength(JSON.stringify(row)) + 1;
    const unit = Math.max(...jobs.map(row => size(row) + size(items.find(entry => entry.id === row.supplier_item_id))));
    const dirs = await splitStorefrontBundle(source, join(dir, "parts"), { mediaBytes: 1e9, jsonBytes: unit * 2 });
    const parts = await Promise.all(dirs.map(async part => JSON.parse(await readFile(join(part, "manifest.json"), "utf8")) as { jobs: unknown[]; enrichments: unknown[] }));
    assert.deepEqual(parts.map(part => [part.jobs.length, part.enrichments.length]), [[0, 0], [2, 0], [2, 0], [2, 0], [0, 1]]);
    const reports: PartReport[] = [];
    for (const part of dirs) reports.push(await apply(part));

    assert.deepEqual(await snapshot(), legacyRows);
    assert.deepEqual(totals(reports), legacyTotals);
    // The outcome itself: inserted, updated, unchanged, skipped, deleted and reset, reset then sent again.
    assert.deepEqual(legacyRows.jobs.map(row => [row.code, row.status, row.last_error]), [
      ["Q-NEW", "complete", null], ["Q-PARTIAL", "partial", null], ["Q-PENDING", "complete", null], ["Q-SAME", "complete", null],
      ["Q-TOMB", "pending", REMOVED_JOB_ERROR], ["Q-TOMB-JOB", "complete", null],
    ]);
    assert.deepEqual(legacyRows.enrichments.map(row => row.code), ["Q-NEW", "Q-PARTIAL", "Q-PENDING", "Q-SAME"]);
    assert.deepEqual(legacyTotals, {
      jobs: 4, skippedJobs: 1, enrichments: 1, skippedEnrichments: 0, tombstones: 2, removedEnrichments: 2, resetJobs: 2, invalidatedJobsReported: 2, tombstonesKept: 0,
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
