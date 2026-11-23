import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { BundleItem } from "./storefront-bundle-items";

// Pure helpers of scripts/sync-storefront-production.ts: the watermark, the run lock and the
// dry-run summary, argument parsing and the retry list of enrichments the target skipped. Paths are relative to the working directory (the checkout the sync runs in).

// AWS is the only target (the VPS target was removed in #563); the field stays so existing state and lock files keep their shape.
export type SyncTarget = "aws";
export type SyncState = {
  snapshotAt: string; syncedAt?: string; target?: SyncTarget; since?: string | null; baseline?: boolean; enrichments?: number; jobs?: number;
  // Supplier items whose enrichments the target skipped (item not there yet); the next export sends them again.
  retry?: BundleItem[];
  // Deleted/invalidated enrichments the run sent (#564; storefront-bundle-tombstones.ts).
  tombstones?: number;
};
type Lock = { pid: number; startedAt: string; target: SyncTarget };

export const SYNC_DIR = ".local/storefront-sync";
export const LOCK_PATH = `${SYNC_DIR}/sync.lock`;
// A sync takes minutes to a few hours; a lock this old is left over even if its pid was reused.
export const LOCK_STALE_MS = 24 * 60 * 60 * 1000;
// Retry keys kept between runs (and written to the inbound report); the count is always reported in full.
export const RETRY_LIMIT = 10_000;

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

// maxDeletions null: the export's default (storefront-bundle-tombstones.ts DEFAULT_MAX_DELETIONS).
export type SyncArgs = { dryRun: boolean; full: boolean; force: boolean; baseline: string | null; maxDeletions: number | null };

/** The sync's flags, strictly: a mistyped flag must never turn into a real run. */
export function parseSyncArgs(argv: string[], now: Date): SyncArgs {
  const parsed: SyncArgs = { dryRun: false, full: false, force: false, baseline: null, maxDeletions: null };
  const usage = "Usage: sync-storefront-production.ts [--dry-run] [--full] [--max-deletions=<n>] [--baseline=<ISO> [--force]]";
  for (const arg of argv) {
    if (arg === "--dry-run" && !parsed.dryRun) parsed.dryRun = true;
    else if (arg === "--full" && !parsed.full) parsed.full = true;
    else if (arg === "--force" && !parsed.force) parsed.force = true;
    else if (arg.startsWith("--baseline=") && parsed.baseline === null) parsed.baseline = parseBaseline(arg.slice("--baseline=".length), now);
    else if (arg.startsWith("--max-deletions=") && parsed.maxDeletions === null) {
      parsed.maxDeletions = parsePositiveInteger(arg.slice("--max-deletions=".length), "--max-deletions");
    }
    else throw new Error(`Unknown or repeated argument: ${arg}. ${usage}`);
  }
  if (parsed.full && parsed.baseline) throw new Error("--full and --baseline exclude each other");
  if (parsed.force && !parsed.baseline) throw new Error("--force only applies to --baseline");
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

/**
 * What the sync needs from an export's manifest.json: the snapshot and counts. The export keeps its enrichments in
 * enrichments.ndjson and records only enrichmentCount (#1316); only these fields are returned, so the parsed jobs and
 * vehicle data are not held in memory while the export is split.
 */
export function exportSummary(text: string) {
  const { snapshotAt, enrichmentCount, jobs, tombstones, invalidatedJobs, maxDeletions } = JSON.parse(text) as {
    snapshotAt?: unknown; enrichmentCount?: unknown; jobs?: unknown[]; tombstones?: unknown[]; invalidatedJobs?: number; maxDeletions?: number;
  };
  if (typeof snapshotAt !== "string") throw new Error("The export's manifest.json has no snapshotAt");
  if (typeof enrichmentCount !== "number") throw new Error("The export's manifest.json has no enrichmentCount");
  return { snapshotAt, enrichmentCount, jobs: jobs?.length ?? 0, tombstones: tombstones?.length ?? 0, invalidatedJobs: invalidatedJobs ?? 0, maxDeletions };
}

// jsonBytes: the size of the part's manifest.json (split-storefront-bundle.ts caps its enrichment JSON, #1316).
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
export type PartReport = { report: Record<string, unknown>; skipped: BundleItem[]; items?: string[] };
export type InboundReport = { snapshotAt?: string | null; parts: number; totals: Record<string, number>; skippedEnrichments: number; skipped: BundleItem[]; truncated: boolean };

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
