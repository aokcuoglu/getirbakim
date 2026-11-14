import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BundleItem } from "./storefront-bundle-items";

// Pure helpers of scripts/sync-storefront-production.ts: the per-target watermark, the run lock and the
// dry-run summary, argument parsing and the retry list of enrichments the target skipped. Paths are relative to the working directory (the checkout the sync runs in).

export type SyncTarget = "vps" | "aws";
export type SyncState = {
  snapshotAt: string; syncedAt?: string; target?: SyncTarget; since?: string | null; baseline?: boolean; enrichments?: number; jobs?: number;
  // Supplier items whose enrichments the target skipped (item not there yet); the next export sends them again.
  retry?: BundleItem[];
};
type Lock = { pid: number; startedAt: string; target: SyncTarget };

export const SYNC_DIR = ".local/storefront-sync";
export const LOCK_PATH = `${SYNC_DIR}/sync.lock`;
// A sync takes minutes to a few hours; a lock this old is left over even if its pid was reused.
export const LOCK_STALE_MS = 24 * 60 * 60 * 1000;
// Retry keys kept between runs (and written to the inbound report); the count is always reported in full.
export const RETRY_LIMIT = 10_000;

/** Each target keeps its own watermark; the VPS keeps the file it always had. */
export function statePath(target: SyncTarget) {
  return target === "aws" ? `${SYNC_DIR}/state.aws.json` : `${SYNC_DIR}/state.json`;
}

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

export type SyncArgs = { dryRun: boolean; full: boolean; force: boolean; baseline: string | null };

/** The sync's flags, strictly: a mistyped flag must never turn into a real run. */
export function parseSyncArgs(argv: string[], now: Date): SyncArgs {
  const parsed: SyncArgs = { dryRun: false, full: false, force: false, baseline: null };
  const usage = "Usage: sync-storefront-production.ts [--dry-run] [--full] [--baseline=<ISO> [--force]]";
  for (const arg of argv) {
    if (arg === "--dry-run" && !parsed.dryRun) parsed.dryRun = true;
    else if (arg === "--full" && !parsed.full) parsed.full = true;
    else if (arg === "--force" && !parsed.force) parsed.force = true;
    else if (arg.startsWith("--baseline=") && parsed.baseline === null) parsed.baseline = parseBaseline(arg.slice("--baseline=".length), now);
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

type PartSummary = { part: string; enrichments: number; mappings: number; jobs: number; media: number; mediaBytes: number };

/** Row and media counts of every part split-storefront-bundle.ts wrote; part-00 (always-complete data) apart. */
export async function summarizeParts(partsDir: string) {
  const names = (await readdir(partsDir)).filter(name => /^part-\d+$/.test(name)).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  const parts: PartSummary[] = [];
  for (const part of names) {
    const manifest = JSON.parse(await readFile(resolve(partsDir, part, "manifest.json"), "utf8")) as {
      enrichments?: unknown[]; products?: unknown[]; jobs?: unknown[]; media?: { size_bytes: number | string }[];
    };
    parts.push({
      part, enrichments: manifest.enrichments?.length ?? 0, mappings: manifest.products?.length ?? 0, jobs: manifest.jobs?.length ?? 0,
      media: manifest.media?.length ?? 0, mediaBytes: (manifest.media ?? []).reduce((sum, object) => sum + Number(object.size_bytes), 0),
    });
  }
  const totals = { parts: parts.length, enrichments: 0, mappings: 0, jobs: 0, media: 0, mediaBytes: 0 };
  for (const part of parts) {
    totals.enrichments += part.enrichments; totals.mappings += part.mappings; totals.jobs += part.jobs;
    totals.media += part.media; totals.mediaBytes += part.mediaBytes;
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

export type PartReport = { report: Record<string, unknown>; skipped: BundleItem[] };
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
 * The retry list after a run: the new report's skipped items replace the old list (the run re-sent the old ones,
 * so whatever is still missing is in the report again). Without a report (an operations image older than #553,
 * or the upload failed) the previous list is kept.
 */
export function nextRetry(previous: BundleItem[] | undefined, report: InboundReport | null, limit = RETRY_LIMIT) {
  const warnings: string[] = [];
  if (!report) {
    warnings.push(`No import report from the target; keeping the previous retry list (${previous?.length ?? 0} items).`);
    return { retry: previous ?? [], warnings };
  }
  const retry = uniqueItems(report.skipped).slice(0, limit);
  if (report.skippedEnrichments > 0) {
    warnings.push(`${report.skippedEnrichments} enrichments were skipped on the target (supplier item not found there); `
      + `${retry.length} are sent again next run.`);
  }
  if (report.truncated || report.skippedEnrichments > retry.length) {
    warnings.push(`The retry list is capped at ${limit}; the other skipped enrichments return only when they are re-imported locally.`);
  }
  return { retry, warnings };
}
