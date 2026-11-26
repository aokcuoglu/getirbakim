import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isClockSkewError, sendWithSkewRetry } from "./storefront-media-read";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { ENRICHMENTS_FILE, ITEMS_FILE, JOBS_FILE, MEDIA_FILE, PRODUCTS_FILE, writeNdjson } from "./storefront-bundle-stream";
import { STATIC_MEDIA_VERSION, staticMediaDigest, VEHICLE_DATA_VERSION, vehicleDataDigest } from "./storefront-bundle-export";
import {
  checkPartUpload, expectedPartObjects, KEEP_RUNS, parsePartListing, parsePrefixMode, parseRootListing, runDirName, staleRunEntries, strayEntries, SYNC_BASE_PREFIX,
  uploadFailure, uploadParts, withS3Concurrency, type UploadIo,
} from "./storefront-upload";
import {
  acquireLock, buildInboundReport, checkInboundReport, exportSummary, importerVersion, nextRetry, nextStaticMediaState, nextVehicleState, parseBaseline, parsePositiveInteger, parseRetryItems, parseSyncArgs,
  parseVehicleDigest, releaseLock, reportKey, sinceFrom, STATE_PATH, staticMediaDigestToSkip, summarizeParts, tombstoneWarnings, VEHICLE_RESEND_DAYS, vehicleDigestToSkip, type StaticMediaState, type VehicleState,
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
  assert.deepEqual(parseSyncArgs([], now), { dryRun: false, full: false, force: false, vehicleData: false, staticMedia: false, baseline: null, maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--dry-run", "--baseline=2026-11-13T05:47:24Z"], now),
    { dryRun: true, full: false, force: false, vehicleData: false, staticMedia: false, baseline: "2026-11-13T05:47:24.000Z", maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--baseline=2026-11-13T05:47:24Z", "--force"], now),
    { dryRun: false, full: false, force: true, vehicleData: false, staticMedia: false, baseline: "2026-11-13T05:47:24.000Z", maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--full"], now), { dryRun: false, full: true, force: false, vehicleData: false, staticMedia: false, baseline: null, maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--max-deletions=5000", "--dry-run"], now), { dryRun: true, full: false, force: false, vehicleData: false, staticMedia: false, baseline: null, maxDeletions: 5000 });
  assert.deepEqual(parseSyncArgs(["--vehicle-data"], now), { dryRun: false, full: false, force: false, vehicleData: true, staticMedia: false, baseline: null, maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--dry-run", "--baseline=2026-11-13T05:47:24Z", "--vehicle-data"], now),
    { dryRun: true, full: false, force: false, vehicleData: true, staticMedia: false, baseline: "2026-11-13T05:47:24.000Z", maxDeletions: null });
  for (const argv of [["--dryrun"], ["-n"], ["--baseline", "2026-11-13T05:47:24Z"], ["--dry-run", "--dry-run"], ["dry-run"], ["--baseline="],
    ["--max-deletions=0"], ["--max-deletions=-1"], ["--max-deletions=1e3"], ["--max-deletions=10.5"], ["--max-deletions="], ["--max-deletions", "10"],
    ["--max-deletions=10", "--max-deletions=20"], ["--vehicle-data", "--vehicle-data"], ["--vehicle-data=1"], ["--vehicle-digest=" + "a".repeat(64)],
    ["--static-media", "--static-media"], ["--static-media=1"], ["--static-digest=" + "a".repeat(64)]]) {
    assert.throws(() => parseSyncArgs(argv, now), Error, argv.join(" "));
  }
  assert.throws(() => parseSyncArgs(["--full", "--baseline=2026-11-13T05:47:24Z"], now), /exclude/);
  assert.throws(() => parseSyncArgs(["--force"], now), /--force only applies/);
  // A real baseline exports nothing the flag could apply to.
  assert.throws(() => parseSyncArgs(["--baseline=2026-11-13T05:47:24Z", "--vehicle-data"], now), /--vehicle-data does not apply to --baseline/);
  assert.deepEqual(parseSyncArgs(["--static-media"], now), { dryRun: false, full: false, force: false, vehicleData: false, staticMedia: true, baseline: null, maxDeletions: null });
  assert.deepEqual(parseSyncArgs(["--dry-run", "--baseline=2026-11-13T05:47:24Z", "--static-media"], now),
    { dryRun: true, full: false, force: false, vehicleData: false, staticMedia: true, baseline: "2026-11-13T05:47:24.000Z", maxDeletions: null });
  assert.throws(() => parseSyncArgs(["--baseline=2026-11-13T05:47:24Z", "--static-media"], now), /--static-media does not apply to --baseline/);
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

// A bundle of three media files, split at 100 bytes into part-00 (the category image), part-01 and part-02; with `jobs`,
// their job part comes right after part-00 and the enrichment parts follow. The export keeps its enrichments, jobs,
// supplier item keys, mappings and media rows in NDJSON files (#1316, #1317).
async function writeFixtureBundle(root: string, jobs: Record<string, unknown>[] = []) {
  const source = join(root, "full");
  for (const object of fixtureMedia) {
    await mkdir(dirname(join(source, "media", object.key)), { recursive: true });
    await writeFile(join(source, "media", object.key), Buffer.alloc(object.size, 1));
  }
  const enrichments = [{ supplier_item_id: "i1", image_id: "a" }, { supplier_item_id: "i2", image_id: "b" }, { supplier_item_id: "i3", image_id: null }];
  const products = [{ supplier_item_id: "i1", category_id: 1 }, { supplier_item_id: "i3", category_id: 1 }];
  const media = fixtureMedia.map(object => ({ id: object.id, object_key: object.key, size_bytes: object.size }));
  await writeFile(join(source, "manifest.json"), JSON.stringify({
    snapshotAt: "2026-11-14T00:00:00Z", categories: [], labels: [], logos: [],
    images: [{ source: "trodo", category_id: 1, media_id: "c" }],
    tombstones: [{ supplier_item_id: "i8", kind: "enrichment_deleted" }],
    enrichmentsFile: ENRICHMENTS_FILE, enrichmentCount: await writeNdjson(join(source, ENRICHMENTS_FILE), enrichments),
    jobsFile: JOBS_FILE, jobCount: await writeNdjson(join(source, JOBS_FILE), jobs),
    itemsFile: ITEMS_FILE, itemCount: await writeNdjson(join(source, ITEMS_FILE), []),
    productsFile: PRODUCTS_FILE, productCount: await writeNdjson(join(source, PRODUCTS_FILE), products),
    mediaFile: MEDIA_FILE, mediaCount: await writeNdjson(join(source, MEDIA_FILE), media),
  }));
  const partsDir = join(root, "parts");
  await splitStorefrontBundle(source, partsDir, { mediaBytes: 100, jsonBytes: 64 * 1024 * 1024 });
  return partsDir;
}

test("the dry-run summary counts every part, part-00 apart; the jobs are in the job part after it", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-summary-"));
  try {
    const partsDir = await writeFixtureBundle(root, [{ supplier_item_id: "i1", status: "complete" }, { supplier_item_id: "i9", status: "partial" }]);
    const summary = await summarizeParts(partsDir);
    // jsonBytes is the size of each part's manifest.json.
    const json = ["part-00", "part-01", "part-02", "part-03"].map(part => statSync(join(partsDir, part, "manifest.json")).size);
    assert.deepEqual(summary.base, { part: "part-00", enrichments: 0, mappings: 0, jobs: 0, tombstones: 1, media: 1, mediaBytes: 10, jsonBytes: json[0] });
    assert.deepEqual(summary.parts, [
      { part: "part-01", enrichments: 0, mappings: 0, jobs: 2, tombstones: 0, media: 0, mediaBytes: 0, jsonBytes: json[1] },
      { part: "part-02", enrichments: 1, mappings: 1, jobs: 0, tombstones: 0, media: 1, mediaBytes: 60, jsonBytes: json[2] },
      { part: "part-03", enrichments: 2, mappings: 1, jobs: 0, tombstones: 0, media: 1, mediaBytes: 70, jsonBytes: json[3] },
    ]);
    assert.deepEqual(summary.totals, {
      parts: 4, enrichments: 3, mappings: 2, jobs: 2, tombstones: 1, media: 3, mediaBytes: 140, jsonBytes: json[0] + json[1] + json[2] + json[3],
    });
    assert.ok(json.every(bytes => bytes > 0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the sync reads the snapshot and counts from the export's manifest; enrichments and jobs are only counted there", () => {
  const manifest = {
    snapshotAt: "2026-11-23T01:29:00.000Z", enrichmentsFile: ENRICHMENTS_FILE, enrichmentCount: 43327, jobsFile: JOBS_FILE, jobCount: 198280, tombstones: [{}],
    invalidatedJobs: 4, maxDeletions: 1000, vehicleSpecs: [{}],
  };
  assert.deepEqual(exportSummary(JSON.stringify(manifest)),
    { snapshotAt: "2026-11-23T01:29:00.000Z", enrichmentCount: 43327, jobs: 198280, tombstones: 1, invalidatedJobs: 4, maxDeletions: 1000, vehicle: null, staticMedia: null });
  assert.deepEqual(exportSummary(JSON.stringify({ snapshotAt: "2026-11-23T01:29:00.000Z", enrichmentCount: 0 })),
    { snapshotAt: "2026-11-23T01:29:00.000Z", enrichmentCount: 0, jobs: 0, tombstones: 0, invalidatedJobs: 0, maxDeletions: undefined, vehicle: null, staticMedia: null });
  // A pre-#1316 export carried the enrichments inline and no count.
  assert.throws(() => exportSummary(JSON.stringify({ snapshotAt: "2026-11-23T01:29:00.000Z", enrichments: [] })), /no enrichmentCount/);
  assert.throws(() => exportSummary(JSON.stringify({ enrichmentCount: 1 })), /no snapshotAt/);
});

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

test("the sync reads the export's vehicle data digest and counts (#1359); an older export has none, a malformed one stops the run", () => {
  const base = { snapshotAt: "2026-11-25T04:29:00.000Z", enrichmentCount: 0 };
  assert.deepEqual(exportSummary(JSON.stringify({ ...base, vehicleSpecs: [], vehicleImages: [], vehicleData: { digest: DIGEST, specs: 37937, images: 26617, sent: false } })).vehicle,
    { digest: DIGEST, specs: 37937, images: 26617, sent: false });
  assert.deepEqual(exportSummary(JSON.stringify({ ...base, vehicleData: { digest: DIGEST, specs: 0, images: 0, sent: true } })).vehicle, { digest: DIGEST, specs: 0, images: 0, sent: true });
  for (const vehicleData of [null, {}, { digest: "A".repeat(64), specs: 1, images: 1, sent: true }, { digest: DIGEST, specs: -1, images: 1, sent: true },
    { digest: DIGEST, specs: 1, images: "1", sent: true }, { digest: DIGEST, specs: 1, images: 1, sent: "yes" }]) {
    assert.throws(() => exportSummary(JSON.stringify({ ...base, vehicleData })), /invalid vehicleData/, JSON.stringify(vehicleData));
  }
});

test("a vehicle digest is 64 lower-case hex digits", () => {
  assert.equal(parseVehicleDigest(DIGEST, "--vehicle-digest"), DIGEST);
  for (const value of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), ` ${"a".repeat(63)}`]) {
    assert.throws(() => parseVehicleDigest(value, "--vehicle-digest"), /--vehicle-digest must be a sha256 hex digest/, value);
  }
});

test("the vehicle data digest is stable and changes with a spec field, an image row, a media checksum or the version", () => {
  const specs = [{ vehicle_type_id: 7, outcome: "found", engine_codes: ["HXDA"], fetched_at: new Date("2026-10-19T00:00:00Z") }];
  const images = [{ vehicle_type_id: 7, media_id: "m1", width: 512, height: 256, imported_at: new Date("2026-10-19T00:00:00Z") }];
  const media = [{ id: "m1", sha256: "1".repeat(64), size_bytes: 2048 }];
  const digest = vehicleDataDigest(specs, images, media);
  assert.match(digest, /^[0-9a-f]{64}$/);
  // The same rows read again (new Date objects, a numeric text size) give the same digest.
  assert.equal(vehicleDataDigest(structuredClone(specs), structuredClone(images), [{ ...media[0], size_bytes: "2048" }]), digest);
  // A media row's other columns (bucket, key, type) are not the target's concern: the importer resolves media by sha256.
  const keyed = [{ ...media[0], object_key: "elsewhere.webp" }];
  assert.equal(vehicleDataDigest(specs, images, keyed), digest);
  for (const changed of [
    vehicleDataDigest([{ ...specs[0], engine_codes: ["HXDB"] }], images, media),
    vehicleDataDigest([...specs, { vehicle_type_id: 8, outcome: "not_found" }], images, media),
    vehicleDataDigest(specs, [{ ...images[0], width: 640 }], media),
    vehicleDataDigest(specs, [], media),
    vehicleDataDigest(specs, images, [{ ...media[0], sha256: "2".repeat(64) }]),
    vehicleDataDigest(specs, images, [{ ...media[0], size_bytes: 2049 }]),
  ]) assert.notEqual(changed, digest);
  assert.equal(VEHICLE_DATA_VERSION, 1);
  const content = (version: number) => JSON.stringify([version, specs, images, media.map(object => [object.id, object.sha256, object.size_bytes])]);
  assert.equal(createHash("sha256").update(content(VEHICLE_DATA_VERSION)).digest("hex"), digest);
  assert.notEqual(createHash("sha256").update(content(VEHICLE_DATA_VERSION + 1)).digest("hex"), digest);
});

const DAY = 24 * 60 * 60 * 1000;
const vehicleState = (sentAt: string, extra: Partial<VehicleState> = {}): VehicleState => ({ digest: DIGEST, specs: 37937, images: 26617, sentAt, ...extra });
const syncState = (vehicle?: VehicleState) => ({ snapshotAt: "2026-11-25T01:32:15.465Z", ...(vehicle ? { vehicle } : {}) });

test("the export may skip the vehicle data only with a confirmed digest younger than a week and no --full or --vehicle-data", () => {
  const now = new Date("2026-11-25T04:30:00Z");
  const flags = { full: false, force: false, now };
  const fresh = syncState(vehicleState("2026-11-24T04:31:00.000Z"));
  assert.deepEqual(vehicleDigestToSkip(fresh, flags), { digest: DIGEST, reason: "unchanged-candidate" });
  assert.deepEqual(vehicleDigestToSkip(null, flags), { digest: null, reason: "no-state" });
  // A state written before #1359, or by a --baseline, has no vehicle entry.
  assert.deepEqual(vehicleDigestToSkip(syncState(), flags), { digest: null, reason: "no-state" });
  assert.deepEqual(vehicleDigestToSkip(fresh, { ...flags, full: true }), { digest: null, reason: "full" });
  assert.deepEqual(vehicleDigestToSkip(fresh, { ...flags, force: true }), { digest: null, reason: "forced" });
  // Resent once the last send is VEHICLE_RESEND_DAYS old.
  assert.equal(VEHICLE_RESEND_DAYS, 7);
  const sentDaysAgo = (ms: number) => syncState(vehicleState(new Date(now.getTime() - ms).toISOString()));
  assert.deepEqual(vehicleDigestToSkip(sentDaysAgo(7 * DAY - 1), flags), { digest: DIGEST, reason: "unchanged-candidate" });
  assert.deepEqual(vehicleDigestToSkip(sentDaysAgo(7 * DAY), flags), { digest: null, reason: "stale" });
  // A send "in the future" (the clock moved) is not trusted either.
  assert.deepEqual(vehicleDigestToSkip(sentDaysAgo(-60_000), flags), { digest: null, reason: "stale" });
  // A hand-edited or truncated entry counts as none.
  for (const vehicle of [{ ...vehicleState("2026-11-24T04:31:00.000Z"), digest: "x" }, { ...vehicleState("2026-11-24T04:31:00.000Z"), sentAt: "soon" },
    { ...vehicleState("2026-11-24T04:31:00.000Z"), specs: -1 }, { digest: DIGEST } as VehicleState]) {
    assert.deepEqual(vehicleDigestToSkip(syncState(vehicle), flags), { digest: null, reason: "no-state" }, JSON.stringify(vehicle));
  }
});

test("the vehicle entry is recorded only when the report accounts for every row sent; an omitted run keeps it until the task definition changes", () => {
  const now = new Date("2026-11-25T05:00:00Z");
  const sent = { digest: OTHER_DIGEST, specs: 37937, images: 26617, sent: true };
  const omitted = { ...sent, digest: DIGEST, sent: false };
  const counts = { vehicleSpecs: 37937, vehicleImages: 26617, skippedVehicleSpecs: 0, skippedVehicleImages: 0 };
  const previous = vehicleState("2026-11-24T05:00:00.000Z", { taskDefinition: "getirbakim-operations:41" });

  // Sent and confirmed: the new digest, counts, send time and task definition.
  assert.deepEqual(nextVehicleState({ previous, exported: sent, totals: { enrichments: 3, ...counts }, taskDefinition: "getirbakim-operations:42", now }), {
    vehicle: { digest: OTHER_DIGEST, specs: 37937, images: 26617, sentAt: "2026-11-25T05:00:00.000Z", taskDefinition: "getirbakim-operations:42", skippedSpecs: 0, skippedImages: 0 },
    warnings: [], notes: [],
  });
  // Rows skipped for a vehicle type missing on the target: recorded, with a warning.
  const skipped = nextVehicleState({ exported: sent, totals: { ...counts, vehicleSpecs: 37930, skippedVehicleSpecs: 7, vehicleImages: 26615, skippedVehicleImages: 2 }, taskDefinition: null, now });
  assert.deepEqual(skipped.vehicle, { digest: OTHER_DIGEST, specs: 37937, images: 26617, sentAt: "2026-11-25T05:00:00.000Z", skippedSpecs: 7, skippedImages: 2 });
  assert.equal(skipped.warnings.length, 1);
  assert.match(skipped.warnings[0], /7 vehicle specs and 2 vehicle images were skipped on the target/);
  assert.match(skipped.warnings[0], /--vehicle-data/);
  // An operations image that ignores the data reports no counts: nothing recorded, the next run sends again.
  const ignored = nextVehicleState({ previous, exported: sent, totals: { enrichments: 3 }, taskDefinition: "getirbakim-operations:42", now });
  assert.equal(ignored.vehicle, undefined);
  assert.match(ignored.warnings[0], /no vehicle data counts/);
  const partial = nextVehicleState({ previous, exported: sent, totals: Object.fromEntries(Object.entries(counts).filter(([name]) => name !== "skippedVehicleImages")), taskDefinition: null, now });
  assert.equal(partial.vehicle, undefined);
  // Counts that do not add up: nothing recorded.
  const short = nextVehicleState({ previous, exported: sent, totals: { ...counts, vehicleImages: 26000 }, taskDefinition: null, now });
  assert.equal(short.vehicle, undefined);
  assert.match(short.warnings[0], /accounted for 37937 of 37937 vehicle specs and 26000 of 26617 vehicle images/);

  // Omitted under the same task definition: the entry stays as it was, sentAt too (the weekly resend still comes).
  const omittedReport = { ...counts, vehicleSpecs: 0, vehicleImages: 0 };
  assert.deepEqual(nextVehicleState({ previous, exported: omitted, totals: omittedReport, taskDefinition: "getirbakim-operations:41", now }),
    { vehicle: previous, warnings: [], notes: [] });
  // Unknown this run: kept.
  assert.deepEqual(nextVehicleState({ previous, exported: omitted, totals: omittedReport, taskDefinition: null, now }).vehicle, previous);
  // Another task definition imported this run: dropped, so the next run sends in full.
  const released = nextVehicleState({ previous, exported: omitted, totals: omittedReport, taskDefinition: "getirbakim-operations:42", now });
  assert.equal(released.vehicle, undefined);
  assert.deepEqual(released.warnings, []);
  assert.match(released.notes[0], /getirbakim-operations:41 -> getirbakim-operations:42/);
  // Rows the target skipped on the last send are only noted while the data is omitted; the entry stays as it was.
  const withSkipped = { ...previous, skippedSpecs: 7, skippedImages: 2 };
  const reminded = nextVehicleState({ previous: withSkipped, exported: omitted, totals: omittedReport, taskDefinition: "getirbakim-operations:41", now });
  assert.deepEqual(reminded.vehicle, withSkipped);
  assert.deepEqual(reminded.warnings, []);
  assert.deepEqual(reminded.notes, ["Vehicle data omitted; 7 specs / 2 images were skipped on the target at 2026-11-24T05:00:00.000Z "
    + "(vehicle type missing there): run with --vehicle-data once their vehicle types exist there."]);
  assert.deepEqual(nextVehicleState({ previous: { ...previous, skippedSpecs: 0, skippedImages: 0 }, exported: omitted, totals: omittedReport, taskDefinition: null, now }).notes, []);
  // An entry without a task definition takes this run's.
  const unnamed = vehicleState("2026-11-24T05:00:00.000Z");
  assert.deepEqual(nextVehicleState({ previous: unnamed, exported: omitted, totals: omittedReport, taskDefinition: "getirbakim-operations:41", now }).vehicle,
    { ...unnamed, taskDefinition: "getirbakim-operations:41" });

  // An export older than #1359 says nothing about the vehicle data.
  assert.deepEqual(nextVehicleState({ previous, exported: null, totals: counts, taskDefinition: null, now }), { warnings: [], notes: [] });
});

const STATIC_IMAGES = [{ source: "trodo", category_id: 1, media_id: "m1", width: 64, height: 64 }];
const STATIC_LOGOS = [{ brand_key: "febi", manufacturer: "FEBI", image_data: "\\x89504e47", sha256: "3".repeat(64), width: 32, height: 32, imported_at: new Date("2026-10-26T00:00:00Z") }];
const STATIC_MEDIA = [{ id: "m1", sha256: "1".repeat(64), size_bytes: 2048 }];

test("the sync reads the export's category image and logo digest (#1379); an older export has none, a malformed one stops the run", () => {
  const base = { snapshotAt: "2026-11-26T04:29:00.000Z", enrichmentCount: 0 };
  assert.deepEqual(exportSummary(JSON.stringify({ ...base, staticMedia: { digest: DIGEST, images: 585, logos: 65, sent: false } })).staticMedia,
    { digest: DIGEST, images: 585, logos: 65, sent: false });
  assert.equal(exportSummary(JSON.stringify(base)).staticMedia, null);
  for (const staticMedia of [null, {}, { digest: "A".repeat(64), images: 1, logos: 1, sent: true }, { digest: DIGEST, images: -1, logos: 1, sent: true },
    { digest: DIGEST, images: 1, logos: "1", sent: true }, { digest: DIGEST, images: 1, logos: 1, sent: "yes" }]) {
    assert.throws(() => exportSummary(JSON.stringify({ ...base, staticMedia })), /invalid staticMedia/, JSON.stringify(staticMedia));
  }
});

test("the category image and logo digest is stable and changes with any row, media checksum or the version", () => {
  const digest = staticMediaDigest(STATIC_IMAGES, STATIC_LOGOS, STATIC_MEDIA);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(staticMediaDigest(structuredClone(STATIC_IMAGES), structuredClone(STATIC_LOGOS), [{ ...STATIC_MEDIA[0], size_bytes: "2048" }]), digest);
  for (const changed of [
    staticMediaDigest([{ ...STATIC_IMAGES[0], width: 128 }], STATIC_LOGOS, STATIC_MEDIA),
    staticMediaDigest(STATIC_IMAGES, [{ ...STATIC_LOGOS[0], image_data: "\\x89504e48" }], STATIC_MEDIA),
    staticMediaDigest(STATIC_IMAGES, [{ ...STATIC_LOGOS[0], sha256: "4".repeat(64) }], STATIC_MEDIA),
    staticMediaDigest(STATIC_IMAGES, STATIC_LOGOS, [{ ...STATIC_MEDIA[0], sha256: "2".repeat(64) }]),
    staticMediaDigest(STATIC_IMAGES, STATIC_LOGOS, [{ ...STATIC_MEDIA[0], size_bytes: 2049 }]),
    staticMediaDigest([], STATIC_LOGOS, STATIC_MEDIA),
    staticMediaDigest(STATIC_IMAGES, [], STATIC_MEDIA),
  ]) assert.notEqual(changed, digest);
  assert.equal(STATIC_MEDIA_VERSION, 1);
  const content = (version: number) => JSON.stringify([version, STATIC_IMAGES, STATIC_LOGOS, STATIC_MEDIA.map(object => [object.id, object.sha256, object.size_bytes])]);
  assert.equal(createHash("sha256").update(content(STATIC_MEDIA_VERSION)).digest("hex"), digest);
  assert.notEqual(createHash("sha256").update(content(STATIC_MEDIA_VERSION + 1)).digest("hex"), digest);
});

const staticState = (sentAt: string, extra: Partial<StaticMediaState> = {}): StaticMediaState => ({ digest: DIGEST, images: 585, logos: 65, sentAt, ...extra });

test("the export may skip category images and logos only with a confirmed digest younger than a week and no --full or --static-media (#1379)", () => {
  const now = new Date("2026-11-26T05:00:00.000Z");
  const flags = { full: false, force: false, now };
  const withStatic = (entry: StaticMediaState) => ({ snapshotAt: "2026-11-25T01:32:15.465Z", staticMedia: entry });
  const fresh = withStatic(staticState("2026-11-25T04:31:00.000Z"));
  assert.deepEqual(staticMediaDigestToSkip(fresh, flags), { digest: DIGEST, reason: "unchanged-candidate" });
  assert.deepEqual(staticMediaDigestToSkip(null, flags), { digest: null, reason: "no-state" });
  assert.deepEqual(staticMediaDigestToSkip({ snapshotAt: "2026-11-25T01:32:15.465Z" }, flags), { digest: null, reason: "no-state" });
  assert.deepEqual(staticMediaDigestToSkip(fresh, { ...flags, full: true }), { digest: null, reason: "full" });
  assert.deepEqual(staticMediaDigestToSkip(fresh, { ...flags, force: true }), { digest: null, reason: "forced" });
  const sentAgo = (ms: number) => withStatic(staticState(new Date(now.getTime() - ms).toISOString()));
  assert.deepEqual(staticMediaDigestToSkip(sentAgo(7 * DAY - 1), flags), { digest: DIGEST, reason: "unchanged-candidate" });
  assert.deepEqual(staticMediaDigestToSkip(sentAgo(7 * DAY), flags), { digest: null, reason: "stale" });
  assert.deepEqual(staticMediaDigestToSkip(sentAgo(-60_000), flags), { digest: null, reason: "stale" });
  for (const entry of [{ ...staticState("2026-11-25T04:31:00.000Z"), digest: "x" }, { ...staticState("2026-11-25T04:31:00.000Z"), sentAt: "soon" },
    { ...staticState("2026-11-25T04:31:00.000Z"), logos: -1 }, { digest: DIGEST } as StaticMediaState]) {
    assert.deepEqual(staticMediaDigestToSkip(withStatic(entry), flags), { digest: null, reason: "no-state" }, JSON.stringify(entry));
  }
});

test("the category image and logo entry is recorded only when the report accounts for every row sent; an omitted run keeps it until the task definition changes (#1379)", () => {
  const now = new Date("2026-11-26T05:00:00.000Z");
  const sent = { digest: OTHER_DIGEST, images: 585, logos: 65, sent: true };
  const omitted = { digest: DIGEST, images: 585, logos: 65, sent: false };
  const counts = { categoryImages: 585, logos: 65 };
  const previous = staticState("2026-11-24T05:00:00.000Z", { taskDefinition: "getirbakim-operations:41" });
  assert.deepEqual(nextStaticMediaState({ previous, exported: sent, totals: counts, taskDefinition: "getirbakim-operations:42", now }), {
    staticMedia: { digest: OTHER_DIGEST, images: 585, logos: 65, sentAt: "2026-11-26T05:00:00.000Z", taskDefinition: "getirbakim-operations:42" }, warnings: [], notes: [],
  });
  const missing = nextStaticMediaState({ previous, exported: sent, totals: {}, taskDefinition: null, now });
  assert.equal(missing.staticMedia, undefined);
  assert.match(missing.warnings[0], /no category image \/ logo counts/);
  const short = nextStaticMediaState({ previous, exported: sent, totals: { categoryImages: 500, logos: 65 }, taskDefinition: null, now });
  assert.equal(short.staticMedia, undefined);
  assert.match(short.warnings[0], /accounted for 500 of 585 category images and 65 of 65 logos/);
  assert.deepEqual(nextStaticMediaState({ previous, exported: omitted, totals: { categoryImages: 0, logos: 0 }, taskDefinition: "getirbakim-operations:41", now }),
    { staticMedia: previous, warnings: [], notes: [] });
  const released = nextStaticMediaState({ previous, exported: omitted, totals: {}, taskDefinition: "getirbakim-operations:42", now });
  assert.equal(released.staticMedia, undefined);
  assert.match(released.notes[0], /41 -> getirbakim-operations:42/);
  const unnamed = staticState("2026-11-24T05:00:00.000Z");
  assert.deepEqual(nextStaticMediaState({ previous: unnamed, exported: omitted, totals: {}, taskDefinition: "getirbakim-operations:41", now }).staticMedia,
    { ...unnamed, taskDefinition: "getirbakim-operations:41" });
  assert.deepEqual(nextStaticMediaState({ exported: omitted, totals: {}, taskDefinition: null, now }), { warnings: [], notes: [] });
  assert.deepEqual(nextStaticMediaState({ previous, exported: null, totals: counts, taskDefinition: null, now }), { warnings: [], notes: [] });
});

const PARTS = ["part-00", "part-01", "part-02"];

// An in-memory bucket under one run prefix; `drop` decides which part syncs silently upload nothing.
const sleep = async () => {};
const recordingSleep = () => { const delays: number[] = []; return { delays, sleep: async (ms: number) => { delays.push(ms); } }; };

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

test("S3 listings parse to relative keys; empty results and the folder marker are handled", () => {
  assert.deepEqual(parsePartListing(null, "storefront/current/part-01/"), []);
  assert.deepEqual(parsePartListing([["storefront/current/part-01/manifest.json", 5], ["storefront/current/part-01/media/a.jpg", 60]], "storefront/current/part-01/"),
    [{ key: "manifest.json", size: 5 }, { key: "media/a.jpg", size: 60 }]);
  assert.deepEqual(parseRootListing(null, "storefront/current"), { keys: [], prefixes: [] });
  assert.deepEqual(parseRootListing({ keys: null, prefixes: null }, "storefront/current"), { keys: [], prefixes: [] });
  assert.deepEqual(parseRootListing({ keys: ["storefront/current/", "storefront/current/x.json"], prefixes: ["storefront/current/part-00/"] }, "storefront/current"),
    { keys: ["x.json"], prefixes: ["part-00/"] });
});

test("an upload that leaves an extra part or root object behind fails the final check", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    for (const extra of ["part-09/manifest.json", "leftover.json"]) {
      const bucket = fakeBucket(partsDir);
      const sync = bucket.io.syncPart;
      bucket.io.syncPart = async part => { await sync(part); if (part === "part-02") bucket.objects.set(extra, 1); };
      await assert.rejects(uploadParts({ partsDir, parts: PARTS, io: bucket.io, log: () => {}, sleep }), new RegExp(`after the upload: ${extra.startsWith("part") ? "part-09/" : "leftover\\.json"}`));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a complete upload returns per-part stats", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io, synced } = fakeBucket(partsDir);
    const lines: string[] = [];
    const stats = await uploadParts({ partsDir, parts: PARTS, io, log: line => lines.push(line), sleep });
    assert.deepEqual(synced, PARTS);
    assert.deepEqual(stats.map(entry => [entry.part, entry.objects, entry.attempts]), [["part-00", 2, 1], ["part-01", 2, 1], ["part-02", 2, 1]]);
    assert.equal(stats[1].bytes, statSync(join(partsDir, "part-01", "manifest.json")).size + 60);
    assert.equal(lines.length, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part silently dropped every time stops the run after four attempts; later parts are never synced", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io, synced } = fakeBucket(partsDir, part => part === "part-01");
    await assert.rejects(uploadParts({ partsDir, parts: PARTS, io, log: () => {}, sleep }), /Upload of part-01 is incomplete: 2 missing .*the import was not started/);
    assert.deepEqual(synced, ["part-00", "part-01", "part-01", "part-01", "part-01"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part dropped once is uploaded on the second attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io } = fakeBucket(partsDir, (part, call) => part === "part-02" && call === 1);
    const stats = await uploadParts({ partsDir, parts: PARTS, io, log: () => {}, sleep });
    assert.deepEqual(stats.map(entry => entry.attempts), [1, 1, 2]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part whose sync throws once is retried after a wait and then passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io } = fakeBucket(partsDir);
    const inner = io.syncPart;
    let calls = 0;
    io.syncPart = async part => { if (part === "part-01" && ++calls === 1) throw new Error("aws s3 sync failed with exit code 1\nCould not connect"); await inner(part); };
    const wait = recordingSleep();
    const lines: string[] = [];
    const stats = await uploadParts({ partsDir, parts: PARTS, io, log: line => lines.push(line), sleep: wait.sleep });
    assert.deepEqual(stats.map(entry => entry.attempts), [1, 2, 1]);
    assert.deepEqual(wait.delays, [30_000]);
    const retry = lines.map(line => JSON.parse(line) as Record<string, unknown>).find(line => line.retry);
    assert.deepEqual(retry, { retry: "part-01", attempt: 1, reason: "sync failed: aws s3 sync failed with exit code 1", waitMs: 30_000 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part whose sync always throws stops the run after four attempts; later parts are never synced", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io, synced } = fakeBucket(partsDir);
    const inner = io.syncPart;
    io.syncPart = async part => { if (part === "part-01") { synced.push(part); throw new Error("endpoint unreachable"); } await inner(part); };
    const wait = recordingSleep();
    await assert.rejects(uploadParts({ partsDir, parts: PARTS, io, log: () => {}, sleep: wait.sleep }), /Upload of part-01 failed after 4 attempts: endpoint unreachable; the import was not started; the watermark stays/);
    assert.deepEqual(synced, ["part-00", "part-01", "part-01", "part-01", "part-01"]);
    assert.deepEqual(wait.delays, [30_000, 60_000, 120_000]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part whose listing throws once is retried after a wait and then passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io } = fakeBucket(partsDir);
    const inner = io.listPart;
    let calls = 0;
    io.listPart = part => { if (part === "part-01" && ++calls === 1) throw new Error("list timed out"); return inner(part); };
    const wait = recordingSleep();
    const stats = await uploadParts({ partsDir, parts: PARTS, io, log: () => {}, sleep: wait.sleep });
    assert.deepEqual(stats.map(entry => entry.attempts), [1, 2, 1]);
    assert.deepEqual(wait.delays, [30_000]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a part whose sync throws a non-Error value on every attempt still fails the run", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io, synced } = fakeBucket(partsDir);
    const inner = io.syncPart;
    io.syncPart = async part => { if (part === "part-01") { synced.push(part); throw undefined; } await inner(part); };
    const wait = recordingSleep();
    await assert.rejects(uploadParts({ partsDir, parts: PARTS, io, log: () => {}, sleep: wait.sleep }), /Upload of part-01 failed after 4 attempts: undefined; the import was not started; the watermark stays/);
    assert.deepEqual(synced, ["part-00", "part-01", "part-01", "part-01", "part-01"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a throw, then a silent drop, then success share one budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const { io } = fakeBucket(partsDir, (part, call) => part === "part-02" && call === 1);
    const inner = io.syncPart;
    let calls = 0;
    io.syncPart = async part => { if (part === "part-02" && ++calls === 1) throw new Error("boom"); await inner(part); };
    const wait = recordingSleep();
    const stats = await uploadParts({ partsDir, parts: PARTS, io, log: () => {}, sleep: wait.sleep });
    assert.deepEqual(stats.map(entry => entry.attempts), [1, 1, 3]);
    assert.deepEqual(wait.delays, [30_000, 60_000]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a stale part of an earlier run is removed before the upload; a stray root object stops the run", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-upload-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const stale = fakeBucket(partsDir);
    stale.objects.set("part-07/manifest.json", 9);
    await uploadParts({ partsDir, parts: PARTS, io: stale.io, log: () => {}, sleep });
    assert.equal([...stale.objects.keys()].some(key => key.startsWith("part-07/")), false);

    const rooted = fakeBucket(partsDir);
    rooted.objects.set("manifest.json", 9);
    await assert.rejects(uploadParts({ partsDir, parts: PARTS, io: rooted.io, log: () => {}, sleep }), /Unexpected objects directly under the run prefix: manifest\.json/);
    assert.deepEqual(rooted.synced, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the prefix mode is current unless run is asked for; a mistyped value is an error", () => {
  assert.equal(parsePrefixMode(undefined), "current");
  assert.equal(parsePrefixMode(""), "current");
  assert.equal(parsePrefixMode("current"), "current");
  assert.equal(parsePrefixMode("run"), "run");
  for (const value of ["runs", "RUN", "1", "true"]) assert.throws(() => parsePrefixMode(value), /must be current or run/, value);
});

test("a run directory is named after the snapshot and sorts in time order", () => {
  assert.equal(runDirName("2026-11-21T08:52:01.308Z"), "run-20261121T085201308Z");
  assert.equal(runDirName("2026-11-21T11:52:01+03:00"), "run-20261121T085201000Z");
  assert.ok(runDirName("2026-11-21T08:52:01.308Z") < runDirName("2026-11-21T10:00:00.000Z"));
  assert.ok(runDirName("2026-11-09T23:59:59.999Z") < runDirName("2026-11-10T00:00:00.000Z"));
  assert.throws(() => runDirName("nonsense"), /Invalid snapshotAt/);
});

test("cleanup removes the fixed-layout parts and runs older than the newest kept; never the current run or a newer one", () => {
  const current = "run-20261121T085201308Z";
  const listed = ["part-00/", "part-01/", "part-12/", "run-20261119T013000000Z/", "run-20261120T013005410Z/", "run-20261121T014213907Z/",
    `${current}/`, "run-20261122T000000000Z/", "notes/", "run-latest/"];
  assert.equal(KEEP_RUNS, 2);
  assert.deepEqual(staleRunEntries(listed, current), ["part-00/", "part-01/", "part-12/", "run-20261120T013005410Z/", "run-20261119T013000000Z/"]);
  assert.deepEqual(staleRunEntries(listed, current, 1), ["part-00/", "part-01/", "part-12/", "run-20261121T014213907Z/", "run-20261120T013005410Z/", "run-20261119T013000000Z/"]);
  assert.deepEqual(staleRunEntries(listed, current, 10), ["part-00/", "part-01/", "part-12/"]);
  assert.deepEqual(staleRunEntries([`${current}/`], current), []);
  for (const keep of [0, -1, 1.5]) assert.throws(() => staleRunEntries(listed, current, keep), /keep must be a positive integer/);
  assert.throws(() => staleRunEntries(listed, "part-01"), /Not a run directory/);
});

// Keys are full bucket keys; the io works on one run prefix like the AWS target does.
function prefixedBucket(partsDir: string, objects: Map<string, number>, prefix: string): UploadIo {
  const under = (base: string) => [...objects].filter(([key]) => key.startsWith(base)).map(([key, size]) => ({ key: key.slice(base.length), size }));
  return {
    syncPart: async part => {
      for (const object of await expectedPartObjects(join(partsDir, part))) objects.set(`${prefix}/${part}/${object.key}`, object.size);
    },
    listPart: part => under(`${prefix}/${part}/`),
    listRoot: () => {
      const entries = under(`${prefix}/`).map(object => object.key);
      return { keys: entries.filter(key => !key.includes("/")), prefixes: [...new Set(entries.filter(key => key.includes("/")).map(key => `${key.split("/")[0]}/`))] };
    },
    removePrefix: path => { for (const key of [...objects.keys()].filter(name => name.startsWith(`${prefix}/${path}`))) objects.delete(key); },
  };
}

test("a run prefix ignores leftovers of the fixed layout and older runs, and cleanup then removes them", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-run-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    // The 2026-11-21 incident layout: part-01 of an earlier run with other media and no manifest.
    const objects = new Map<string, number>([
      [`${SYNC_BASE_PREFIX}/part-01/media/p/old.jpg`, 3], [`${SYNC_BASE_PREFIX}/part-01/media/p/a.jpg`, 1],
      [`${SYNC_BASE_PREFIX}/run-20261120T013005410Z/part-01/manifest.json`, 9], [`${SYNC_BASE_PREFIX}/run-20261119T013000000Z/part-00/manifest.json`, 9],
    ]);
    const run = runDirName("2026-11-21T08:52:01.308Z");
    const stats = await uploadParts({ partsDir, parts: PARTS, io: prefixedBucket(partsDir, objects, `${SYNC_BASE_PREFIX}/${run}`), log: () => {} });
    assert.deepEqual(stats.map(entry => entry.attempts), [1, 1, 1]);
    // The upload left everything outside its own prefix alone.
    assert.equal(objects.get(`${SYNC_BASE_PREFIX}/part-01/media/p/old.jpg`), 3);

    const base = prefixedBucket(partsDir, objects, SYNC_BASE_PREFIX);
    const stale = staleRunEntries((await base.listRoot()).prefixes, run);
    assert.deepEqual(stale, ["part-01/", "run-20261119T013000000Z/"]);
    for (const entry of stale) await base.removePrefix(entry);
    assert.deepEqual([...new Set([...objects.keys()].map(key => key.split("/").slice(0, 3).join("/")))].sort(),
      [`${SYNC_BASE_PREFIX}/run-20261120T013005410Z`, `${SYNC_BASE_PREFIX}/${run}`]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a run prefix with a part missing its manifest or with a mis-sized file fails before the import", async () => {
  const root = await mkdtemp(join(tmpdir(), "storefront-run-"));
  try {
    const partsDir = await writeFixtureBundle(root);
    const prefix = `${SYNC_BASE_PREFIX}/${runDirName("2026-11-21T08:52:01.308Z")}`;
    for (const [damage, pattern] of [
      [(objects: Map<string, number>) => objects.delete(`${prefix}/part-01/manifest.json`), /part-01 is incomplete: 1 missing \(manifest\.json\)/],
      [(objects: Map<string, number>) => objects.set(`${prefix}/part-01/media/p/a.jpg`, 59), /part-01 is incomplete: 1 size mismatch \(media\/p\/a\.jpg\)/],
    ] as const) {
      const objects = new Map<string, number>();
      const io = prefixedBucket(partsDir, objects, prefix);
      const sync = io.syncPart;
      io.syncPart = async part => { await sync(part); if (part === "part-01") damage(objects); };
      await assert.rejects(uploadParts({ partsDir, parts: PARTS, io, log: () => {}, sleep }), pattern);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the S3 concurrency goes into the profile's s3 block of a config copy; other profiles and s3 settings stay", () => {
  const config = ["[default]", "region = eu-west-1", "", "[profile sync]", "role_arn = arn:x", "source_profile = base", "", "[profile base]", "region = eu-central-1", ""].join("\n");
  assert.equal(withS3Concurrency(config, "sync", 32),
    ["[default]", "region = eu-west-1", "", "[profile sync]", "s3 =", "  max_concurrent_requests = 32", "role_arn = arn:x", "source_profile = base", "", "[profile base]", "region = eu-central-1", ""].join("\n"));
  const nested = ["[profile sync]", "s3 =", "  max_concurrent_requests = 4", "  multipart_threshold = 64MB", "region = eu-central-1"].join("\n");
  assert.equal(withS3Concurrency(nested, "sync", 20),
    ["[profile sync]", "s3 =", "  max_concurrent_requests = 20", "  multipart_threshold = 64MB", "region = eu-central-1"].join("\n"));
  assert.throws(() => withS3Concurrency(config, "missing", 8), /\[profile missing\] is not in the AWS config/);
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

test("the importer version (#1380) decides over the task definition when both sides know it", () => {
  const now = new Date("2026-11-26T05:00:00Z");
  const TD41 = "getirbakim-operations:41", TD42 = "getirbakim-operations:42";
  const vehicle = (extra: Partial<VehicleState>) => vehicleState("2026-11-24T05:00:00.000Z", extra);
  const media = (extra: Partial<StaticMediaState>) => staticState("2026-11-24T05:00:00.000Z", extra);
  const omittedVehicle = { digest: DIGEST, specs: 37937, images: 26617, sent: false };
  const omittedMedia = { digest: DIGEST, images: 585, logos: 65, sent: false };
  const runVehicle = (previous: VehicleState, taskDefinition: string | null, importerVersion: string | null) =>
    nextVehicleState({ previous, exported: omittedVehicle, totals: {}, taskDefinition, importerVersion, now });
  const runMedia = (previous: StaticMediaState, taskDefinition: string | null, importerVersion: string | null) =>
    nextStaticMediaState({ previous, exported: omittedMedia, totals: {}, taskDefinition, importerVersion, now });

  // Same version, new task definition (an env or secret deploy): both entries stay as they were.
  const keptVehicle = vehicle({ taskDefinition: TD41, importerVersion: "aaa111" });
  assert.deepEqual(runVehicle(keptVehicle, TD42, "aaa111"), { vehicle: keptVehicle, warnings: [], notes: [] });
  const keptMedia = media({ taskDefinition: TD41, importerVersion: "aaa111" });
  assert.deepEqual(runMedia(keptMedia, TD42, "aaa111"), { staticMedia: keptMedia, warnings: [], notes: [] });

  // Changed version: dropped with a note, even with the same task definition.
  const droppedVehicle = runVehicle(keptVehicle, TD41, "bbb222");
  assert.equal(droppedVehicle.vehicle, undefined);
  assert.match(droppedVehicle.notes[0], /importer version changed .*aaa111 -> bbb222.*sends it in full/);
  const droppedMedia = runMedia(keptMedia, TD41, "bbb222");
  assert.equal(droppedMedia.staticMedia, undefined);
  assert.match(droppedMedia.notes[0], /importer version changed .*aaa111 -> bbb222.*sends them in full/);

  // A version missing on either side: the task definition rule as before.
  for (const [previous, version] of [[vehicle({ taskDefinition: TD41 }), "bbb222"], [keptVehicle, null]] as const) {
    assert.equal(runVehicle(previous, TD42, version).vehicle, undefined);
    assert.match(runVehicle(previous, TD42, version).notes[0], /task definition changed/);
  }
  for (const [previous, version] of [[media({ taskDefinition: TD41 }), "bbb222"], [keptMedia, null]] as const) {
    assert.equal(runMedia(previous, TD42, version).staticMedia, undefined);
    assert.match(runMedia(previous, TD42, version).notes[0], /task definition changed/);
  }
  assert.deepEqual(runVehicle(keptVehicle, TD41, null).vehicle, keptVehicle);

  // A kept entry without a version adopts this run's; a sent entry records it.
  assert.deepEqual(runVehicle(vehicle({ taskDefinition: TD41 }), TD41, "aaa111").vehicle, { ...vehicle({ taskDefinition: TD41 }), importerVersion: "aaa111" });
  assert.deepEqual(runMedia(media({ taskDefinition: TD41 }), TD41, "aaa111").staticMedia, { ...media({ taskDefinition: TD41 }), importerVersion: "aaa111" });
  const sentVehicle = nextVehicleState({
    exported: { digest: OTHER_DIGEST, specs: 1, images: 2, sent: true },
    totals: { vehicleSpecs: 1, vehicleImages: 2, skippedVehicleSpecs: 0, skippedVehicleImages: 0 }, taskDefinition: TD42, importerVersion: "aaa111", now,
  });
  assert.equal(sentVehicle.vehicle?.importerVersion, "aaa111");
  const sentMedia = nextStaticMediaState({ exported: { digest: OTHER_DIGEST, images: 585, logos: 65, sent: true }, totals: { categoryImages: 585, logos: 65 }, taskDefinition: null, importerVersion: "aaa111", now });
  assert.equal(sentMedia.staticMedia?.importerVersion, "aaa111");
});

test("importerVersion reads BUILD_VERSION and treats an unset or development image as unknown", () => {
  assert.equal(importerVersion({ BUILD_VERSION: " 0123456789ab " }), "0123456789ab");
  for (const value of [undefined, "", "development"]) assert.equal(importerVersion({ BUILD_VERSION: value }), null);
});
