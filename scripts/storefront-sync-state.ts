import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { BundleItem } from "./storefront-bundle-items";

// Pure helpers of scripts/sync-storefront-production.ts: the watermark, the run lock and the
// dry-run summary, argument parsing, the retry list of enrichments the target skipped, and the REPXPERT vehicle data and
// the category images and logos (#1379) the target confirmed. Paths are relative to the working directory (the checkout the sync runs in).

// AWS is the only target (the VPS target was removed in #563); the field stays so existing state and lock files keep their shape.
export type SyncTarget = "aws";
// The REPXPERT vehicle data the target last confirmed (#1359): the export's digest of it, its row counts, when it was sent,
// the operations task definition (family:revision) that imported it and the rows it skipped (vehicle type missing there).
export type VehicleState = {
  digest: string; specs: number; images: number; sentAt: string; taskDefinition?: string; importerVersion?: string; skippedSpecs?: number; skippedImages?: number;
};
// The category images and manufacturer logos the target last confirmed (#1379): the export's digest of them, their row counts,
// when they were sent and the operations task definition that imported them.
export type StaticMediaState = { digest: string; images: number; logos: number; sentAt: string; taskDefinition?: string; importerVersion?: string };
export type SyncState = {
  snapshotAt: string; syncedAt?: string; target?: SyncTarget; since?: string | null; baseline?: boolean; enrichments?: number; jobs?: number;
  // Supplier items whose enrichments the target skipped (item not there yet); the next export sends them again.
  retry?: BundleItem[];
  // Deleted/invalidated enrichments the run sent (#564; storefront-bundle-tombstones.ts).
  tombstones?: number;
  // Written only after a report confirmed the vehicle data; while its digest matches, exports leave the data out (#1359).
  vehicle?: VehicleState;
  // Written only after a report confirmed the category images and logos; while its digest matches, exports leave them out (#1379).
  staticMedia?: StaticMediaState;
};
type Lock = { pid: number; startedAt: string; target: SyncTarget };

export const SYNC_DIR = ".local/storefront-sync";
export const LOCK_PATH = `${SYNC_DIR}/sync.lock`;
// A sync takes minutes to a few hours; a lock this old is left over even if its pid was reused.
export const LOCK_STALE_MS = 24 * 60 * 60 * 1000;
// Retry keys kept between runs (and written to the inbound report); the count is always reported in full.
export const RETRY_LIMIT = 10_000;
// Unchanged REPXPERT vehicle data (#1359) and category images and logos (#1379) are still sent in full once their last
// confirmed send is this old: a target restored or edited behind the sync's back gets them back within a week.
export const RESEND_DAYS = 7;
export const VEHICLE_RESEND_DAYS = RESEND_DAYS;
const DAY_MS = 24 * 60 * 60 * 1000;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The watermark file (kept under its aws name so the existing watermark keeps working). */
export const STATE_PATH = `${SYNC_DIR}/state.aws.json`;

/** The next run's --since: the last snapshot minus the overlap, or null (everything) without a state. */
export function sinceFrom(state: Pick<SyncState, "snapshotAt"> | null, overlapMs: number) {
  if (!state) return null;
  const at = new Date(state.snapshotAt).getTime();
  if (Number.isNaN(at)) throw new Error(`Invalid snapshotAt in the sync state: ${state.snapshotAt}`);
  return new Date(at - overlapMs).toISOString();
}

/** A --baseline value: an ISO timestamp with an explicit time zone (Z or ±hh:mm) that is not in the future. */
export function parseBaseline(iso: string, now: Date) {
  const at = new Date(iso);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso) || Number.isNaN(at.getTime())) {
    throw new Error(`--baseline must be an ISO timestamp with a time zone (e.g. 2026-11-13T05:47:24Z): ${iso}`);
  }
  if (at.getTime() > now.getTime()) throw new Error(`--baseline is in the future: ${iso}`);
  return at.toISOString();
}

/** A flag's value that must be a positive integer (digits only, no sign, exponent or fraction). */
export function parsePositiveInteger(value: string, flag: string) {
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number)) throw new Error(`${flag} must be a positive integer: ${value}`);
  return number;
}

/** A data digest (export-storefront-bundle.ts --vehicle-digest, --static-digest): 64 lower-case hex digits, nothing else. */
export function parseDigest(value: string, flag: string) {
  if (!SHA256_HEX.test(value)) throw new Error(`${flag} must be a sha256 hex digest: ${value}`);
  return value;
}
export const parseVehicleDigest = parseDigest;

// maxDeletions null: the export's default (storefront-bundle-tombstones.ts DEFAULT_MAX_DELETIONS).
// vehicleData: send the REPXPERT vehicle data in full even if the target confirmed the same digest (#1359).
// staticMedia: the same for the category images and logos (#1379).
export type SyncArgs = { dryRun: boolean; full: boolean; force: boolean; vehicleData: boolean; staticMedia: boolean; baseline: string | null; maxDeletions: number | null };

/** The sync's flags, strictly: a mistyped flag must never turn into a real run. */
export function parseSyncArgs(argv: string[], now: Date): SyncArgs {
  const parsed: SyncArgs = { dryRun: false, full: false, force: false, vehicleData: false, staticMedia: false, baseline: null, maxDeletions: null };
  const usage = "Usage: sync-storefront-production.ts [--dry-run] [--full] [--vehicle-data] [--static-media] [--max-deletions=<n>] [--baseline=<ISO> [--force]]";
  for (const arg of argv) {
    if (arg === "--dry-run" && !parsed.dryRun) parsed.dryRun = true;
    else if (arg === "--full" && !parsed.full) parsed.full = true;
    else if (arg === "--force" && !parsed.force) parsed.force = true;
    else if (arg === "--vehicle-data" && !parsed.vehicleData) parsed.vehicleData = true;
    else if (arg === "--static-media" && !parsed.staticMedia) parsed.staticMedia = true;
    else if (arg.startsWith("--baseline=") && parsed.baseline === null) parsed.baseline = parseBaseline(arg.slice("--baseline=".length), now);
    else if (arg.startsWith("--max-deletions=") && parsed.maxDeletions === null) {
      parsed.maxDeletions = parsePositiveInteger(arg.slice("--max-deletions=".length), "--max-deletions");
    }
    else throw new Error(`Unknown or repeated argument: ${arg}. ${usage}`);
  }
  if (parsed.full && parsed.baseline) throw new Error("--full and --baseline exclude each other");
  if (parsed.force && !parsed.baseline) throw new Error("--force only applies to --baseline");
  // A baseline only records the watermark; it exports nothing for the flag to apply to.
  if (parsed.vehicleData && parsed.baseline && !parsed.dryRun) throw new Error("--vehicle-data does not apply to --baseline without --dry-run");
  if (parsed.staticMedia && parsed.baseline && !parsed.dryRun) throw new Error("--static-media does not apply to --baseline without --dry-run");
  return parsed;
}

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): Lock {
  const text = readFileSync(path, "utf8");
  try { return JSON.parse(text) as Lock; } catch {
    throw new Error(`Lock ${path} is unreadable; delete it if no sync is running.`);
  }
}

/** One sync at a time: a lock held by a live process stops this run, a dead holder's lock is taken over. */
export function acquireLock(path: string, owner: { pid: number; target: SyncTarget }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try { fd = openSync(path, "wx"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = readLock(path);
      const age = Date.now() - new Date(held.startedAt).getTime();
      if (Number.isNaN(age)) throw new Error(`Lock ${path} has no valid startedAt; delete it if no sync is running.`);
      if (alive(held.pid) && age < LOCK_STALE_MS) {
        throw new Error(`Another storefront sync is running (pid ${held.pid}, target ${held.target}, since ${held.startedAt}); `
          + `lock ${path} — delete it if that process is not a sync.`);
      }
      unlinkSync(path);
      continue;
    }
    try { writeSync(fd, JSON.stringify({ pid: owner.pid, startedAt: new Date().toISOString(), target: owner.target } satisfies Lock)); } finally { closeSync(fd); }
    return;
  }
  throw new Error(`Could not take over the stale lock ${path}.`);
}

/** Removes the lock if this process holds it. */
export function releaseLock(path: string, pid = process.pid) {
  try {
    if (readLock(path).pid === pid) unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

// The export's manifest.vehicleData (#1359): the digest and row counts of the REPXPERT vehicle data and whether the export sent it.
export type ExportedVehicle = { digest: string; specs: number; images: number; sent: boolean };

// The export's manifest.staticMedia (#1379): the digest and row counts of the category images and logos and whether the export sent them.
export type ExportedStaticMedia = { digest: string; images: number; logos: number; sent: boolean };

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * What the sync needs from an export's manifest.json: the snapshot and counts. The export keeps its enrichments and
 * job statuses in NDJSON files and records only enrichmentCount and jobCount (#1316, #1317); only these fields are
 * returned, so the parsed vehicle data is not held in memory while the export is split. vehicle is the export's
 * vehicleData, null for an export older than #1359; staticMedia likewise for one older than #1379.
 */
export function exportSummary(text: string) {
  const { snapshotAt, enrichmentCount, jobCount, tombstones, invalidatedJobs, maxDeletions, vehicleData, staticMedia: staticData } = JSON.parse(text) as {
    snapshotAt?: unknown; enrichmentCount?: unknown; jobCount?: unknown; tombstones?: unknown[]; invalidatedJobs?: number; maxDeletions?: number;
    vehicleData?: Partial<Record<keyof ExportedVehicle, unknown>> | null;
    staticMedia?: Partial<Record<keyof ExportedStaticMedia, unknown>> | null;
  };
  if (typeof snapshotAt !== "string") throw new Error("The export's manifest.json has no snapshotAt");
  if (typeof enrichmentCount !== "number") throw new Error("The export's manifest.json has no enrichmentCount");
  let vehicle: ExportedVehicle | null = null;
  if (vehicleData !== undefined) {
    const { digest, specs, images, sent } = vehicleData ?? {};
    if (typeof digest !== "string" || !SHA256_HEX.test(digest) || !isCount(specs) || !isCount(images) || typeof sent !== "boolean") {
      throw new Error(`The export's manifest.json has an invalid vehicleData: ${JSON.stringify(vehicleData)}`);
    }
    vehicle = { digest, specs, images, sent };
  }
  let staticMedia: ExportedStaticMedia | null = null;
  if (staticData !== undefined) {
    const { digest, images, logos, sent } = staticData ?? {};
    if (typeof digest !== "string" || !SHA256_HEX.test(digest) || !isCount(images) || !isCount(logos) || typeof sent !== "boolean") {
      throw new Error(`The export's manifest.json has an invalid staticMedia: ${JSON.stringify(staticData)}`);
    }
    staticMedia = { digest, images, logos, sent };
  }
  return {
    snapshotAt, enrichmentCount, jobs: typeof jobCount === "number" ? jobCount : 0, tombstones: tombstones?.length ?? 0, invalidatedJobs: invalidatedJobs ?? 0, maxDeletions,
    vehicle, staticMedia,
  };
}

// Why an export gets (or does not get) the digest of the last confirmed data; only "unchanged-candidate" passes one.
export type SendReason = "no-state" | "full" | "forced" | "stale" | "unchanged-candidate";
export type VehicleSendReason = SendReason;

/** A state's vehicle entry if it has the shape the sync writes (a hand-edited or truncated one counts as none). */
function validVehicle(vehicle: VehicleState | undefined) {
  if (!vehicle || typeof vehicle.digest !== "string" || !SHA256_HEX.test(vehicle.digest) || !isCount(vehicle.specs) || !isCount(vehicle.images)) return null;
  if (typeof vehicle.sentAt !== "string" || Number.isNaN(new Date(vehicle.sentAt).getTime())) return null;
  return vehicle;
}

/** A state's category image and logo entry if it has the shape the sync writes. */
function validStaticMedia(entry: StaticMediaState | undefined) {
  if (!entry || typeof entry.digest !== "string" || !SHA256_HEX.test(entry.digest) || !isCount(entry.images) || !isCount(entry.logos)) return null;
  if (typeof entry.sentAt !== "string" || Number.isNaN(new Date(entry.sentAt).getTime())) return null;
  return entry;
}

function digestToSkip(entry: { digest: string; sentAt: string } | null, opts: { full: boolean; force: boolean; now: Date }): { digest: string | null; reason: SendReason } {
  if (opts.full) return { digest: null, reason: "full" };
  if (opts.force) return { digest: null, reason: "forced" };
  if (!entry) return { digest: null, reason: "no-state" };
  const age = opts.now.getTime() - new Date(entry.sentAt).getTime();
  if (age < 0 || age >= RESEND_DAYS * DAY_MS) return { digest: null, reason: "stale" };
  return { digest: entry.digest, reason: "unchanged-candidate" };
}

/**
 * The digest the export may compare its REPXPERT vehicle data with (#1359): the last confirmed one, unless there is none
 * (first run, a fresh state, a new --baseline), --full or --vehicle-data asks for everything, or it was sent
 * RESEND_DAYS ago or more (or "in the future", after a clock change). digest null: the export sends the data in full.
 */
export function vehicleDigestToSkip(state: SyncState | null, opts: { full: boolean; force: boolean; now: Date }) {
  return digestToSkip(validVehicle(state?.vehicle), opts);
}

/** The same for the category images and logos (#1379): force is --static-media. */
export function staticMediaDigestToSkip(state: SyncState | null, opts: { full: boolean; force: boolean; now: Date }) {
  return digestToSkip(validStaticMedia(state?.staticMedia), opts);
}

// jsonBytes: the size of the part's manifest.json (split-storefront-bundle.ts caps the JSON of its enrichments, #1316,
// and of its jobs, #1317). Job statuses travel in the job parts after part-00, so base.jobs is 0.
type PartSummary = { part: string; enrichments: number; mappings: number; jobs: number; tombstones: number; media: number; mediaBytes: number; jsonBytes: number };

/** Row and media counts of every part split-storefront-bundle.ts wrote; part-00 (always-complete data) apart. */
export async function summarizeParts(partsDir: string) {
  const names = (await readdir(partsDir)).filter(name => /^part-\d+$/.test(name)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const parts: PartSummary[] = [];
  for (const part of names) {
    const path = resolve(partsDir, part, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      enrichments?: unknown[]; products?: unknown[]; jobs?: unknown[]; tombstones?: unknown[]; media?: { size_bytes: number | string }[];
    };
    parts.push({
      part, enrichments: manifest.enrichments?.length ?? 0, mappings: manifest.products?.length ?? 0, jobs: manifest.jobs?.length ?? 0,
      tombstones: manifest.tombstones?.length ?? 0,
      media: manifest.media?.length ?? 0, mediaBytes: (manifest.media ?? []).reduce((sum, object) => sum + Number(object.size_bytes), 0),
      jsonBytes: (await stat(path)).size,
    });
  }
  const totals = { parts: parts.length, enrichments: 0, mappings: 0, jobs: 0, tombstones: 0, media: 0, mediaBytes: 0, jsonBytes: 0 };
  for (const part of parts) {
    totals.enrichments += part.enrichments; totals.mappings += part.mappings; totals.jobs += part.jobs; totals.tombstones += part.tombstones;
    totals.media += part.media; totals.mediaBytes += part.mediaBytes; totals.jsonBytes += part.jsonBytes;
  }
  const base = parts.find(part => part.part === "part-00") ?? null;
  return { base, parts: parts.filter(part => part !== base), totals };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_FIELDS = ["supplier", "company", "list_group", "warehouse", "code"] as const;

/** The supplier item keys of an --retry-file (an array of bundle items); anything else is rejected. */
export function parseRetryItems(text: string): BundleItem[] {
  const value: unknown = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error("The retry file must be a JSON array of supplier items");
  return value.map((entry: unknown) => {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item.id !== "string" || !UUID.test(item.id)) throw new Error(`Retry item without a uuid id: ${JSON.stringify(entry)}`);
    const parsed: BundleItem = { id: item.id };
    for (const field of KEY_FIELDS) {
      if (item[field] == null) continue;
      if (typeof item[field] !== "string") throw new Error(`Retry item ${item.id} has a non-text ${field}`);
      parsed[field] = item[field];
    }
    return parsed;
  });
}

/**
 * Where import-storefront-inbound.ts writes its report: the media bucket (S3_BUCKET), which the operations task may
 * write, under a private prefix keyed by the inbound prefix (the task may only read the inbound bucket).
 */
export function reportKey(prefix: string) {
  return `internal/storefront-sync/${prefix.replace(/^\/+|\/+$/g, "")}/report.json`;
}

/** One part's --report of import-storefront-bundle.ts; items (local supplier items it wrote) stay on the target, report.json never carries them. */
export type PartReport = { importerVersion?: string | null; report: Record<string, unknown>; skipped: BundleItem[]; items?: string[] };
/**
 * The importer's own version (#1380): BUILD_VERSION as the operations task definition sets it (the infra repo puts the image
 * tag there, the release's commit, the same value /api/health shows; the Dockerfile's operations stage does not carry it).
 * null when unset or "development" (local runs); then, and if infra ever drops that env, the task definition rule applies.
 */
export function importerVersion(env: Record<string, string | undefined> = process.env) {
  const raw = (env.BUILD_VERSION ?? "").trim();
  return raw && raw !== "development" ? raw : null;
}

/**
 * Whether an entry sent by an earlier importer must be sent again. Both versions known: only a changed version counts and the
 * task definition is ignored (env and secret deploys bump it without touching the importer). Either one unknown (old importer,
 * old state): the task definition rule.
 */
function importerChanged(previous: { taskDefinition?: string; importerVersion?: string }, current: { taskDefinition: string | null; importerVersion: string | null }) {
  if (current.importerVersion && previous.importerVersion) return { changed: current.importerVersion !== previous.importerVersion, by: "version" as const };
  return { changed: Boolean(current.taskDefinition && previous.taskDefinition && current.taskDefinition !== previous.taskDefinition), by: "taskDefinition" as const };
}

/** What a kept entry still lacks and this run knows: an entry without a task definition or version takes this run's. */
function adopted(previous: { taskDefinition?: string; importerVersion?: string }, taskDefinition: string | null, version: string | null) {
  return {
    ...(!previous.taskDefinition && taskDefinition ? { taskDefinition } : {}),
    ...(!previous.importerVersion && version ? { importerVersion: version } : {}),
  };
}

/** The identity fields an entry adopts from this run (the version when known; the task definition as before). */
function importerStamp(taskDefinition: string | null, version: string | null) {
  return { ...(taskDefinition ? { taskDefinition } : {}), ...(version ? { importerVersion: version } : {}) };
}

export type InboundReport = { snapshotAt?: string | null; importerVersion?: string | null; parts: number; totals: Record<string, number>; skippedEnrichments: number; skipped: BundleItem[]; truncated: boolean };

function uniqueItems(items: BundleItem[]) {
  return [...new Map(items.map(item => [item.id, item])).values()];
}

/** report.json of import-storefront-inbound.ts: summed counts of the applied parts and the items they skipped. */
export function buildInboundReport(parts: PartReport[], limit = RETRY_LIMIT): InboundReport {
  const totals: Record<string, number> = {};
  for (const { report } of parts) {
    for (const [key, value] of Object.entries(report)) if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
  }
  const skipped = uniqueItems(parts.flatMap(part => part.skipped));
  return { parts: parts.length, totals, skippedEnrichments: skipped.length, skipped: skipped.slice(0, limit), truncated: skipped.length > limit };
}

/**
 * The report of this run, or an error that keeps the watermark where it was: a missing report (an operations image
 * older than #553) or one written for another bundle says nothing about what this run skipped. The next run sends
 * the same data again, which the import applies idempotently.
 */
export function checkInboundReport(report: InboundReport | null, snapshotAt: string): InboundReport {
  if (!report) throw new Error("The import task finished but wrote no report.json (operations image older than #553?); the watermark stays, the next run re-sends.");
  if (report.snapshotAt !== snapshotAt) {
    throw new Error(`report.json belongs to another bundle (snapshotAt ${report.snapshotAt ?? "none"}, this run ${snapshotAt}); the watermark stays, the next run re-sends.`);
  }
  return report;
}

/**
 * The retry list after a run: the new report's skipped items replace the old list (the run re-sent the old ones,
 * so whatever is still missing is in the report again).
 */
export function nextRetry(report: InboundReport, limit = RETRY_LIMIT) {
  const warnings: string[] = [];
  const retry = uniqueItems(report.skipped).slice(0, limit);
  if (report.skippedEnrichments > 0) {
    warnings.push(`${report.skippedEnrichments} enrichments were skipped on the target (supplier item not found there); `
      + `${retry.length} are sent again next run.`);
  }
  if (report.truncated || report.skippedEnrichments > retry.length) {
    warnings.push(`The retry list is capped at ${limit}; the other skipped enrichments return only when they are re-imported locally `
      + "or when the target has their products and a run with --full sends everything.");
  }
  return { retry, warnings };
}

/**
 * The vehicle entry of the state after a run whose report matched its bundle (#1359), with what to print about it.
 * - The export sent the data: recorded only if the report accounts for every row (written + skipped for a missing vehicle
 *   type, per table). A report without those counts (an operations image that ignores the data) or with other counts
 *   records nothing, so the next run sends it in full again. Skipped rows are recorded with a warning: they come back
 *   only with the next full send.
 * - The export left it out: the previous entry stays (its sentAt too, so the weekly resend still comes), with a note
 *   while it holds rows the target skipped (they wait for the next full send). When the operations task definition
 *   differs from the one that imported the data (a release may have changed the importer), the entry is dropped so the
 *   next run sends in full; an entry without one takes this run's. When both sides know the importer version (#1380), only
 *   a changed version drops the entry and the task definition is ignored.
 * - An export without vehicleData (older than #1359): no entry.
 */
export function nextVehicleState(input: {
  previous?: VehicleState; exported: ExportedVehicle | null; totals: Record<string, number>; taskDefinition: string | null; importerVersion?: string | null; now: Date;
}): { vehicle?: VehicleState; warnings: string[]; notes: string[] } {
  const { previous, exported, totals, taskDefinition, now } = input;
  const version = input.importerVersion ?? null;
  const warnings: string[] = [], notes: string[] = [];
  if (!exported) return { warnings, notes };
  if (!exported.sent) {
    if (!previous) return { warnings, notes };
    const change = importerChanged(previous, { taskDefinition, importerVersion: version });
    if (change.changed) {
      notes.push(change.by === "version"
        ? `The importer version changed since the vehicle data was sent (${previous.importerVersion} -> ${version}); the next run sends it in full.`
        : `The operations task definition changed since the vehicle data was sent (${previous.taskDefinition} -> ${taskDefinition}); the next run sends it in full.`);
      return { warnings, notes };
    }
    const skippedSpecs = previous.skippedSpecs ?? 0, skippedImages = previous.skippedImages ?? 0;
    if (skippedSpecs > 0 || skippedImages > 0) {
      notes.push(`Vehicle data omitted; ${skippedSpecs} specs / ${skippedImages} images were skipped on the target at ${previous.sentAt} `
        + "(vehicle type missing there): run with --vehicle-data once their vehicle types exist there.");
    }
    return { vehicle: { ...previous, ...adopted(previous, taskDefinition, version) }, warnings, notes };
  }
  const { vehicleSpecs: specs, vehicleImages: images, skippedVehicleSpecs: skippedSpecs, skippedVehicleImages: skippedImages } = totals;
  if (![specs, images, skippedSpecs, skippedImages].every(value => typeof value === "number")) {
    warnings.push("The import report has no vehicle data counts (operations image that ignores the REPXPERT data?); it is sent in full again next run.");
    return { warnings, notes };
  }
  if (specs + skippedSpecs !== exported.specs || images + skippedImages !== exported.images) {
    warnings.push(`The target accounted for ${specs + skippedSpecs} of ${exported.specs} vehicle specs and ${images + skippedImages} of ${exported.images} vehicle images; `
      + "the vehicle data is sent in full again next run.");
    return { warnings, notes };
  }
  if (skippedSpecs > 0 || skippedImages > 0) {
    warnings.push(`${skippedSpecs} vehicle specs and ${skippedImages} vehicle images were skipped on the target (vehicle type missing there); they are sent again `
      + `when the vehicle data changes, after ${VEHICLE_RESEND_DAYS} days or with --vehicle-data.`);
  }
  return {
    vehicle: { digest: exported.digest, specs: exported.specs, images: exported.images, sentAt: now.toISOString(), ...importerStamp(taskDefinition, version), skippedSpecs, skippedImages },
    warnings, notes,
  };
}

/**
 * The category image and logo entry of the state after a run whose report matched its bundle (#1379), with what to print about it.
 * - The export sent them: recorded only if the report's categoryImages and logos counts equal the exported rows (the importer
 *   upserts every row, skipping none). A report without those counts or with other counts records nothing, so the next run
 *   sends them in full again.
 * - The export left them out: the previous entry stays (its sentAt too, so the weekly resend still comes). When the operations
 *   task definition differs from the one that imported them, the entry is dropped so the next run sends in full; an entry
 *   without one takes this run's.
 * - An export without staticMedia (older than #1379): no entry.
 */
export function nextStaticMediaState(input: {
  previous?: StaticMediaState; exported: ExportedStaticMedia | null; totals: Record<string, number>; taskDefinition: string | null; importerVersion?: string | null; now: Date;
}): { staticMedia?: StaticMediaState; warnings: string[]; notes: string[] } {
  const { previous, exported, totals, taskDefinition, now } = input;
  const version = input.importerVersion ?? null;
  const warnings: string[] = [], notes: string[] = [];
  if (!exported) return { warnings, notes };
  if (!exported.sent) {
    if (!previous) return { warnings, notes };
    const change = importerChanged(previous, { taskDefinition, importerVersion: version });
    if (change.changed) {
      notes.push(change.by === "version"
        ? `The importer version changed since the category images and logos were sent (${previous.importerVersion} -> ${version}); the next run sends them in full.`
        : `The operations task definition changed since the category images and logos were sent (${previous.taskDefinition} -> ${taskDefinition}); the next run sends them in full.`);
      return { warnings, notes };
    }
    return { staticMedia: { ...previous, ...adopted(previous, taskDefinition, version) }, warnings, notes };
  }
  const { categoryImages: images, logos } = totals;
  if (typeof images !== "number" || typeof logos !== "number") {
    warnings.push("The import report has no category image / logo counts; they are sent in full again next run.");
    return { warnings, notes };
  }
  if (images !== exported.images || logos !== exported.logos) {
    warnings.push(`The target accounted for ${images} of ${exported.images} category images and ${logos} of ${exported.logos} logos; they are sent in full again next run.`);
    return { warnings, notes };
  }
  return {
    staticMedia: { digest: exported.digest, images: exported.images, logos: exported.logos, sentAt: now.toISOString(), ...importerStamp(taskDefinition, version) },
    warnings, notes,
  };
}

/**
 * What the sync prints about the tombstones it sent (#564). A report without a tombstones count comes from an
 * operations image older than #564, which ignores them: a warning, not an error (the watermark still moves; the
 * export sends tombstones whatever the watermark until they leave the retention window).
 */
export function tombstoneWarnings(report: InboundReport, sent: number, retentionDays: number) {
  const warnings: string[] = [], notes: string[] = [];
  const totals = report.totals;
  if (sent > 0 && totals.tombstones === undefined) {
    warnings.push(`The operations image predates #564: ${sent} deletions were not applied on the target. Run release-aws; `
      + `they are sent again on every run for ${retentionDays} days.`);
  } else if ((totals.removedEnrichments ?? 0) > 0 || (totals.invalidatedJobsReported ?? 0) > 0) {
    notes.push(`Tombstones: ${totals.removedEnrichments ?? 0} enrichments removed on the target (${totals.removedEnrichmentMappings ?? 0} mappings, `
      + `${totals.resetJobs ?? 0} jobs back to pending), ${totals.tombstonesKept ?? 0} kept there, `
      + `${totals.invalidatedJobsReported ?? 0} invalidated jobs only reported.`);
  }
  return { warnings, notes };
}
