import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import {
  acquireLock, buildInboundReport, checkInboundReport, nextRetry, parseBaseline, parseRetryItems, parseSyncArgs, releaseLock, reportKey, sinceFrom,
  statePath, summarizeParts,
} from "./storefront-sync-state";

test("each target keeps its own watermark; the VPS keeps state.json", () => {
  assert.equal(statePath("vps"), ".local/storefront-sync/state.json");
  assert.equal(statePath("aws"), ".local/storefront-sync/state.aws.json");
});

test("the next --since is the last snapshot minus the overlap; no state sends everything", () => {
  assert.equal(sinceFrom({ snapshotAt: "2026-11-13T05:47:24.000Z" }, 60 * 60 * 1000), "2026-11-13T04:47:24.000Z");
  assert.equal(sinceFrom(null, 60 * 60 * 1000), null);
  assert.throws(() => sinceFrom({ snapshotAt: "nonsense" }, 0), /Invalid snapshotAt/);
});

test("a baseline must be an ISO timestamp that is not in the future", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  assert.equal(parseBaseline("2026-11-13T05:47:24Z", now), "2026-11-13T05:47:24.000Z");
  assert.throws(() => parseBaseline("yesterday", now), /ISO timestamp/);
  assert.throws(() => parseBaseline("2026-13-40T00:00:00Z", now), /ISO timestamp/);
  assert.throws(() => parseBaseline("2026", now), /ISO timestamp/);
  assert.throws(() => parseBaseline("2026-11-15T00:00:00Z", now), /future/);
  // A naive timestamp would be read in the machine's time zone.
  assert.throws(() => parseBaseline("2026-11-13T05:47:24", now), /time zone/);
  assert.throws(() => parseBaseline("2026-11-13", now), /time zone/);
  assert.equal(parseBaseline("2026-11-13T08:47:24+03:00", now), "2026-11-13T05:47:24.000Z");
  assert.equal(parseBaseline("2026-11-13T05:47:24.5Z", now), "2026-11-13T05:47:24.500Z");
});

test("sync arguments are parsed strictly; a mistyped flag never becomes a real run", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  assert.deepEqual(parseSyncArgs([], now), { dryRun: false, full: false, force: false, baseline: null });
  assert.deepEqual(parseSyncArgs(["--dry-run", "--baseline=2026-11-13T05:47:24Z"], now),
    { dryRun: true, full: false, force: false, baseline: "2026-11-13T05:47:24.000Z" });
  assert.deepEqual(parseSyncArgs(["--baseline=2026-11-13T05:47:24Z", "--force"], now),
    { dryRun: false, full: false, force: true, baseline: "2026-11-13T05:47:24.000Z" });
  assert.deepEqual(parseSyncArgs(["--full"], now), { dryRun: false, full: true, force: false, baseline: null });
  for (const argv of [["--dryrun"], ["-n"], ["--baseline", "2026-11-13T05:47:24Z"], ["--dry-run", "--dry-run"], ["dry-run"], ["--baseline="]]) {
    assert.throws(() => parseSyncArgs(argv, now), Error, argv.join(" "));
  }
  assert.throws(() => parseSyncArgs(["--full", "--baseline=2026-11-13T05:47:24Z"], now), /exclude/);
  assert.throws(() => parseSyncArgs(["--force"], now), /--force only applies/);
});

test("the lock admits one live sync, takes over a dead holder's lock and is free again after release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "storefront-lock-"));
  const path = join(dir, "sync.lock");
  try {
    acquireLock(path, { pid: process.pid, target: "aws" });
    const held = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(held.pid, process.pid);
    assert.equal(held.target, "aws");
    assert.ok(!Number.isNaN(new Date(held.startedAt).getTime()));
    assert.throws(() => acquireLock(path, { pid: process.pid, target: "vps" }),
      (error: Error) => /Another storefront sync is running/.test(error.message) && error.message.includes(path) && /delete it if that process is not a sync/.test(error.message));

    // Another process's release leaves the lock alone.
    releaseLock(path, process.pid + 1);
    assert.ok(existsSync(path));
    releaseLock(path);
    assert.ok(!existsSync(path));
    acquireLock(path, { pid: process.pid, target: "vps" });
    releaseLock(path);

    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    writeFileSync(path, JSON.stringify({ pid: dead, startedAt: "2026-11-13T00:00:00Z", target: "aws" }));
    acquireLock(path, { pid: process.pid, target: "aws" });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, process.pid);
    releaseLock(path);
    releaseLock(path); // Releasing a missing lock is harmless.

    // A lock older than a day is stale even if its pid now belongs to a live process.
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), target: "aws" }));
    acquireLock(path, { pid: process.pid, target: "vps" });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).target, "vps");
    releaseLock(path);

    // A lock without a valid start time is not taken over.
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: "soon", target: "aws" }));
    assert.throws(() => acquireLock(path, { pid: process.pid, target: "aws" }), /no valid startedAt/);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).startedAt, "soon");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the dry-run summary counts every part, part-00 apart", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-summary-"));
  const source = join(root, "full");
  const media = [{ id: "c", key: "cat/c.jpg", size: 10 }, { id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 70 }];
  try {
    for (const object of media) {
      await mkdir(dirname(join(source, "media", object.key)), { recursive: true });
      await writeFile(join(source, "media", object.key), Buffer.alloc(object.size, 1));
    }
    await writeFile(join(source, "manifest.json"), JSON.stringify({
      snapshotAt: "2026-11-14T00:00:00Z", categories: [], labels: [], logos: [],
      images: [{ source: "trodo", category_id: 1, media_id: "c" }],
      jobs: [{ supplier_item_id: "i1", status: "complete" }, { supplier_item_id: "i9", status: "partial" }],
      enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }, { supplier_item_id: "i3", image_id: null }],
      products: [{ supplier_item_id: "i1", category_id: 1 }, { supplier_item_id: "i3", category_id: 1 }],
      media: media.map(object => ({ id: object.id, object_key: object.key, size_bytes: object.size })),
    }));
    const partsDir = join(root, "parts");
    await splitStorefrontBundle(source, partsDir, 100);
    const summary = await summarizeParts(partsDir);
    assert.deepEqual(summary.base, { part: "part-00", enrichments: 0, mappings: 0, jobs: 2, media: 1, mediaBytes: 10 });
    assert.deepEqual(summary.parts, [
      { part: "part-01", enrichments: 1, mappings: 1, jobs: 0, media: 1, mediaBytes: 60 },
      { part: "part-02", enrichments: 2, mappings: 1, jobs: 0, media: 1, mediaBytes: 70 },
    ]);
    assert.deepEqual(summary.totals, { parts: 3, enrichments: 3, mappings: 2, jobs: 2, media: 3, mediaBytes: 140 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

const item = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, supplier: "basbug", company: "C", list_group: "L", warehouse: "MRK", code: `C${n}` });

test("a retry file holds supplier items with a uuid and text keys", () => {
  assert.deepEqual(parseRetryItems(JSON.stringify([item(1), { id: item(2).id }])), [item(1), { id: item(2).id }]);
  assert.deepEqual(parseRetryItems("[]"), []);
  assert.throws(() => parseRetryItems("{}"), /JSON array/);
  assert.throws(() => parseRetryItems(JSON.stringify([{ id: "x" }])), /uuid/);
  assert.throws(() => parseRetryItems(JSON.stringify([{ ...item(1), code: 7 }])), /non-text code/);
});

test("the inbound report sums the applied parts and lists each skipped item once, capped", () => {
  const report = buildInboundReport([
    { report: { enrichments: 3, skippedEnrichments: 1, note: "x" }, skipped: [item(1)] },
    { report: { enrichments: 2, skippedEnrichments: 2 }, skipped: [item(2), item(1)] },
  ], 1);
  assert.deepEqual(report, { parts: 2, totals: { enrichments: 5, skippedEnrichments: 3 }, skippedEnrichments: 2, skipped: [item(1)], truncated: true });
});

test("the written items of each part stay out of the inbound report", () => {
  const parts = [
    { report: { enrichments: 3, skippedEnrichments: 1 }, skipped: [item(1)] },
    { report: { enrichments: 2, skippedEnrichments: 0 }, skipped: [] },
  ];
  const withItems = parts.map((part, index) => ({ ...part, items: [item(10 + index).id, item(20).id] }));
  const report = buildInboundReport(withItems);
  assert.deepEqual(report, buildInboundReport(parts));
  assert.deepEqual(report.totals, { enrichments: 5, skippedEnrichments: 1 });
  assert.ok(!("items" in report));
  assert.ok(!JSON.stringify(report).includes(item(20).id));
});

test("the retry list is replaced by each new report", () => {
  const report = (skipped: ReturnType<typeof item>[], truncated = false) => ({ parts: 1, totals: {}, skippedEnrichments: skipped.length, skipped, truncated });
  // Item 1 was retried and is still missing; item 2 arrived on the target; item 3 is new.
  const replaced = nextRetry(report([item(1), item(3)]));
  assert.deepEqual(replaced.retry, [item(1), item(3)]);
  assert.match(replaced.warnings[0], /2 enrichments were skipped/);
  assert.deepEqual(nextRetry(report([])), { retry: [], warnings: [] });

  const capped = nextRetry(report([item(1), item(2), item(3)]), 2);
  assert.deepEqual(capped.retry, [item(1), item(2)]);
  assert.match(capped.warnings[1], /capped at 2/);
  assert.match(capped.warnings[1], /--full/);
});

test("only this bundle's report lets the watermark move", () => {
  const report = { snapshotAt: "2026-11-14T16:38:43.465Z", parts: 2, totals: {}, skippedEnrichments: 0, skipped: [], truncated: false };
  assert.equal(checkInboundReport(report, "2026-11-14T16:38:43.465Z"), report);
  assert.throws(() => checkInboundReport(null, "2026-11-14T16:38:43.465Z"), /wrote no report\.json/);
  assert.throws(() => checkInboundReport(report, "2026-11-15T00:00:00.000Z"), /belongs to another bundle \(snapshotAt 2026-11-14T16:38:43\.465Z/);
  assert.throws(() => checkInboundReport({ ...report, snapshotAt: undefined }, "2026-11-15T00:00:00.000Z"), /snapshotAt none/);
});

test("the report lives in the media bucket under a private prefix keyed by the inbound prefix", () => {
  assert.equal(reportKey("storefront/current"), "internal/storefront-sync/storefront/current/report.json");
  assert.equal(reportKey("/storefront/current/"), "internal/storefront-sync/storefront/current/report.json");
});
