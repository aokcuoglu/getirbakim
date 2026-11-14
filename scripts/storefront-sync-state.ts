import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Pure helpers of scripts/sync-storefront-production.ts: the per-target watermark, the run lock and the
// dry-run summary. Paths are relative to the working directory (the checkout the sync runs in).

export type SyncTarget = "vps" | "aws";
export type SyncState = {
  snapshotAt: string; syncedAt?: string; target?: SyncTarget; since?: string | null; baseline?: boolean; enrichments?: number; jobs?: number;
};
type Lock = { pid: number; startedAt: string; target: SyncTarget };

export const SYNC_DIR = ".local/storefront-sync";
export const LOCK_PATH = `${SYNC_DIR}/sync.lock`;

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

/** A --baseline value: an ISO timestamp that is not in the future. */
export function parseBaseline(iso: string, now: Date) {
  const at = new Date(iso);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso) || Number.isNaN(at.getTime())) throw new Error(`--baseline must be an ISO timestamp (e.g. 2026-11-13T05:47:24Z): ${iso}`);
  if (at.getTime() > now.getTime()) throw new Error(`--baseline is in the future: ${iso}`);
  return at.toISOString();
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
    throw new Error(`${path} is unreadable; remove it once no sync is running.`);
  }
}

/** One sync at a time: a lock held by a live process stops this run, a dead holder's lock is taken over. */
export function acquireLock(path: string, owner: { pid: number; target: SyncTarget }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try { fd = openSync(path, "wx"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = readLock(path);
      if (alive(held.pid)) throw new Error(`Another storefront sync is running (pid ${held.pid}, target ${held.target}, since ${held.startedAt}).`);
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
