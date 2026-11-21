import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isClockSkewError, sendWithSkewRetry } from "./storefront-media-read";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { checkPartUpload, expectedPartObjects, strayEntries, uploadFailure, uploadParts, type UploadIo } from "./storefront-upload";
import {
  acquireLock, buildInboundReport, checkInboundReport, nextRetry, parseBaseline, parsePositiveInteger, parseRetryItems, parseSyncArgs, releaseLock, reportKey,
  sinceFrom, STATE_PATH, summarizeParts, tombstoneWarnings,
} from "./storefront-sync-state";

test("the watermark stays in state.aws.json", () => {
  assert.equal(STATE_PATH, ".local/storefront-sync/state.aws.json");
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
  assert.deepEqual(parseSyncArgs([], now), { dryRun: false, full: false, force: false, baseline: null, maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--dry-run", "--baseline=2026-11-13T05:47:24Z"], now),
    { dryRun: true, full: false, force: false, baseline: "2026-11-13T05:47:24.000Z", maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--baseline=2026-11-13T05:47:24Z", "--force"], now),
    { dryRun: false, full: false, force: true, baseline: "2026-11-13T05:47:24.000Z", maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--full"], now), { dryRun: false, full: true, force: false, baseline: null, maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--max-deletions=5000", "--dry-run"], now), { dryRun: true, full: false, force: false, baseline: null, maxDeletions: 5000 });
  for (const argv of [["--dryrun"], ["-n"], ["--baseline", "2026-11-13T05:47:24Z"], ["--dry-run", "--dry-run"], ["dry-run"], ["--baseline="],
    ["--max-deletions=0"], ["--max-deletions=-1"], ["--max-deletions=1e3"], ["--max-deletions=10.5"], ["--max-deletions="], ["--max-deletions", "10"],
    ["--max-deletions=10", "--max-deletions=20"]]) {
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
    assert.throws(() => acquireLock(path, { pid: process.pid, target: "aws" }),
      (error: Error) => /Another storefront sync is running/.test(error.message) && error.message.includes(path) && /delete it if that process is not a sync/.test(error.message));

    // Another process's release leaves the lock alone.
    releaseLock(path, process.pid + 1);
    assert.ok(existsSync(path));
    releaseLock(path);
    assert.ok(!existsSync(path));
    acquireLock(path, { pid: process.pid, target: "aws" });
    releaseLock(path);

    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    writeFileSync(path, JSON.stringify({ pid: dead, startedAt: "2026-11-13T00:00:00Z", target: "aws" }));
    acquireLock(path, { pid: process.pid, target: "aws" });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, process.pid);
    releaseLock(path);
    releaseLock(path); // Releasing a missing lock is harmless.

    // A lock older than a day is stale even if its pid now belongs to a live process.
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), target: "aws" }));
    acquireLock(path, { pid: process.pid, target: "aws" });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).target, "aws");
    releaseLock(path);

    // A lock without a valid start time is not taken over.
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: "soon", target: "aws" }));
    assert.throws(() => acquireLock(path, { pid: process.pid, target: "aws" }), /no valid startedAt/);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).startedAt, "soon");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

const fixtureMedia = [{ id: "c", key: "cat/c.jpg", size: 10 }, { id: "a", key: "p/a.jpg", size: 60 }, { id: "b", key: "p/b.jpg", size: 70 }];

// A bundle of three media files, split at 100 bytes into part-00 (the category image), part-01 and part-02.
async function writeFixtureBundle(root: string) {
  const source = join(root, "full");
  for (const object of fixtureMedia) {
    await mkdir(dirname(join(source, "media", object.key)), { recursive: true });
    await writeFile(join(source, "media", object.key), Buffer.alloc(object.size, 1));
  }
  await writeFile(join(source, "manifest.json"), JSON.stringify({
    snapshotAt: "2026-11-14T00:00:00Z", categories: [], labels: [], logos: [],
    images: [{ source: "trodo", category_id: 1, media_id: "c" }],
    jobs: [{ supplier_item_id: "i1", status: "complete" }, { supplier_item_id: "i9", status: "partial" }],
    tombstones: [{ supplier_item_id: "i8", kind: "enrichment_deleted" }],
    enrichments: [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }, { supplier_item_id: "i3", image_id: null }],
    products: [{ supplier_item_id: "i1", category_id: 1 }, { supplier_item_id: "i3", category_id: 1 }],
    media: fixtureMedia.map(object => ({ id: object.id, object_key: object.key, size_bytes: object.size })),
  }));
  const partsDir = join(root, "parts");
  await splitStorefrontBundle(source, partsDir, 100);
  return partsDir;
}

test("the dry-run summary counts every part, part-00 apart", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-summary-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const summary = await summarizeParts(partsDir);
    assert.deepEqual(summary.base, { part: "part-00", enrichments: 0, mappings: 0, jobs: 2, tombstones: 1, media: 1, mediaBytes: 10 });
    assert.deepEqual(summary.parts, [
      { part: "part-01", enrichments: 1, mappings: 1, jobs: 0, tombstones: 0, media: 1, mediaBytes: 60 },
      { part: "part-02", enrichments: 2, mappings: 1, jobs: 0, tombstones: 0, media: 1, mediaBytes: 70 },
    ]);
    assert.deepEqual(summary.totals, { parts: 3, enrichments: 3, mappings: 2, jobs: 2, tombstones: 1, media: 3, mediaBytes: 140 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

const PARTS = ["part-00", "part-01", "part-02"];

// An in-memory bucket under one run prefix; `drop` decides which part syncs silently upload nothing.
function fakeBucket(partsDir: string, drop: (part: string, call: number) => boolean = () => false) {
  const objects = new Map<string, number>();
  const synced: string[] = [];
  const io: UploadIo = {
    syncPart: async part => {
      synced.push(part);
      if (drop(part, synced.filter(name => name === part).length)) return;
      for (const key of [...objects.keys()].filter(name => name.startsWith(`${part}/`))) objects.delete(key);
      for (const object of await expectedPartObjects(join(partsDir, part))) objects.set(`${part}/${object.key}`, object.size);
    },
    listPart: part => [...objects].filter(([key]) => key.startsWith(`${part}/`)).map(([key, size]) => ({ key: key.slice(part.length + 1), size })),
    listRoot: () => ({
      keys: [...objects.keys()].filter(key => !key.includes("/")),
      prefixes: [...new Set([...objects.keys()].filter(key => key.includes("/")).map(key => `${key.split("/")[0]}/`))],
    }),
    removePrefix: prefix => { for (const key of [...objects.keys()].filter(name => name.startsWith(prefix))) objects.delete(key); },
  };
  return { objects, synced, io };
}

test("the expected objects of a part are its manifest and every media file; a missing or mis-sized file throws", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-expected-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const expected = await expectedPartObjects(join(partsDir, "part-01"));
    assert.deepEqual(expected.map(object => object.key), ["manifest.json", "media/p/a.jpg"]);
    assert.equal(expected[0].size, statSync(join(partsDir, "part-01", "manifest.json")).size);
    assert.equal(expected[1].size, 60);
    await writeFile(join(partsDir, "part-01", "media", "p", "a.jpg"), Buffer.alloc(59, 1));
    await assert.rejects(expectedPartObjects(join(partsDir, "part-01")), /is 59 bytes, the manifest says 60/);
    await rm(join(partsDir, "part-01", "media", "p", "a.jpg"));
    await assert.rejects(expectedPartObjects(join(partsDir, "part-01")), /media\/p\/a\.jpg listed in the manifest is missing/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part check classifies missing, mis-sized and unexpected objects", () => {
  const expected = [{ key: "manifest.json", size: 5 }, { key: "media/a.jpg", size: 60 }, { key: "media/b.jpg", size: 70 }];
  assert.deepEqual(checkPartUpload(expected, expected), { missing: [], sizeMismatch: [], unexpected: [] });
  assert.equal(uploadFailure("part-01", checkPartUpload(expected, expected)), null);
  // The 2026-11-21 incident: the manifest never arrived while objects of an older run were still there.
  const incident = checkPartUpload(expected, [{ key: "media/a.jpg", size: 60 }, { key: "media/b.jpg", size: 1 }, { key: "media/old.jpg", size: 3 }]);
  assert.deepEqual(incident, { missing: ["manifest.json"], sizeMismatch: ["media/b.jpg"], unexpected: ["media/old.jpg"] });
  const message = uploadFailure("part-01", incident);
  assert.match(message ?? "", /1 missing \(manifest\.json\); 1 size mismatch \(media\/b\.jpg\); 1 unexpected \(media\/old\.jpg\); the import was not started; the watermark stays$/);
});

test("stray entries are stale parts and root-level objects", () => {
  const parts = ["part-00", "part-01", "part-02", "part-03"];
  assert.deepEqual(strayEntries(parts, ["part-00/", "part-01/", "part-02/", "part-03/"], []), []);
  assert.deepEqual(strayEntries(parts, ["part-00/", "part-07/"], ["manifest.json"]), ["part-07/", "manifest.json"]);
});

test("a complete upload returns per-part stats", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io, synced } = fakeBucket(partsDir);
    const lines: string[] = [];
    const stats = await uploadParts({ partsDir, parts: PARTS, io, log: line => lines.push(line) });
    assert.deepEqual(synced, PARTS);
    assert.deepEqual(stats.map(entry => [entry.part, entry.objects, entry.attempts]), [["part-00", 2, 1], ["part-01", 2, 1], ["part-02", 2, 1]]);
    assert.equal(stats[1].bytes, statSync(join(partsDir, "part-01", "manifest.json")).size + 60);
    assert.equal(lines.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part silently dropped twice stops the run after two attempts; later parts are never synced", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io, synced } = fakeBucket(partsDir, part => part === "part-01");
    await assert.rejects(uploadParts({ partsDir, parts: PARTS, io, log: () => {} }), /Upload of part-01 is incomplete: 2 missing .*the import was not started/);
    assert.deepEqual(synced, ["part-00", "part-01", "part-01"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part dropped once is uploaded on the second attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io } = fakeBucket(partsDir, (part, call) => part === "part-02" && call === 1);
    const stats = await uploadParts({ partsDir, parts: PARTS, io, log: () => {} });
    assert.deepEqual(stats.map(entry => entry.attempts), [1, 1, 2]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a stale part of an earlier run is removed before the upload; a stray root object stops the run", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const stale = fakeBucket(partsDir);
    stale.objects.set("part-07/manifest.json", 9);
    await uploadParts({ partsDir, parts: PARTS, io: stale.io, log: () => {} });
    assert.equal([...stale.objects.keys()].some(key => key.startsWith("part-07/")), false);

    const rooted = fakeBucket(partsDir);
    rooted.objects.set("manifest.json", 9);
    await assert.rejects(uploadParts({ partsDir, parts: PARTS, io: rooted.io, log: () => {} }), /Unexpected objects directly under the run prefix: manifest\.json/);
    assert.deepEqual(rooted.synced, []);
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

test("a positive integer flag accepts digits only", () => {
  assert.equal(parsePositiveInteger("1000", "--max-deletions"), 1000);
  for (const value of ["0", "-5", "07", "1e3", "2.5", " 3", "", "99999999999999999999"]) {
    assert.throws(() => parsePositiveInteger(value, "--max-deletions"), /--max-deletions must be a positive integer/, value);
  }
});

test("tombstones an operations image older than #564 ignored are a warning; applied ones a note", () => {
  const report = (totals: Record<string, number>) => ({ snapshotAt: "x", parts: 1, totals, skippedEnrichments: 0, skipped: [], truncated: false });
  const old = tombstoneWarnings(report({ enrichments: 3 }), 4, 90);
  assert.equal(old.warnings.length, 1);
  assert.match(old.warnings[0], /predates #564: 4 deletions were not applied/);
  assert.match(old.warnings[0], /release-aws/);
  assert.match(old.warnings[0], /90 days/);
  assert.deepEqual(old.notes, []);
  // Nothing sent: an old image is not worth a warning.
  assert.deepEqual(tombstoneWarnings(report({ enrichments: 3 }), 0, 90), { warnings: [], notes: [] });
  const applied = tombstoneWarnings(report({ tombstones: 4, removedEnrichments: 2, removedEnrichmentMappings: 3, resetJobs: 2, tombstonesKept: 1, invalidatedJobsReported: 1 }), 4, 90);
  assert.deepEqual(applied.warnings, []);
  assert.deepEqual(applied.notes, ["Tombstones: 2 enrichments removed on the target (3 mappings, 2 jobs back to pending), 1 kept there, 1 invalidated jobs only reported."]);
  assert.deepEqual(tombstoneWarnings(report({ tombstones: 4, removedEnrichments: 0, tombstonesKept: 4, invalidatedJobsReported: 0 }), 4, 90), { warnings: [], notes: [] });
});

test("a clock-skew error is retried and the read then succeeds", async () => {
  let calls = 0;
  const waits: number[] = [];
  const skew = Object.assign(new Error("The difference between the request time and the server's time is too large."), { name: "RequestTimeTooSkewed", $metadata: { httpStatusCode: 403, attempts: 1 } });
  const value = await sendWithSkewRetry(async () => { if (++calls === 1) throw skew; return "bytes"; }, { delaysMs: [5, 10], wait: async (ms) => { waits.push(ms); } });
  assert.equal(value, "bytes");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [5]);
});

test("clock skew that never clears gives up after the bounded retries", async () => {
  let calls = 0;
  const skew = Object.assign(new Error("skew"), { name: "RequestTimeTooSkewed" });
  await assert.rejects(sendWithSkewRetry(async () => { calls++; throw skew; }, { delaysMs: [1, 1], wait: async () => {} }), skew);
  assert.equal(calls, 3);
});

test("AccessDenied, NoSuchKey and NoSuchBucket fail on the first attempt", async () => {
  for (const name of ["AccessDenied", "NoSuchKey", "NoSuchBucket"]) {
    let calls = 0;
    const failure = Object.assign(new Error(name), { name });
    await assert.rejects(sendWithSkewRetry(async () => { calls++; throw failure; }, { delaysMs: [1, 1], wait: async () => {} }), failure);
    assert.equal(calls, 1);
    assert.equal(isClockSkewError(failure), false);
  }
});
