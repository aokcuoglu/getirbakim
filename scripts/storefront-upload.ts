import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// Verification of the storefront parts uploaded to the AWS inbound bucket (#1129): every part is listed back and
// compared with its own manifest before the import task may start. A silently incomplete upload (a sleeping Mac, a
// dropped connection) would otherwise be imported as if it were whole.

/** An object in the bucket; `key` is relative to the part prefix (`manifest.json`, `media/<object_key>`). */
export type RemoteObject = { key: string; size: number };
export type PartCheck = { missing: string[]; sizeMismatch: string[]; unexpected: string[] };
export type RootListing = { keys: string[]; prefixes: string[] };
export type PartStats = { part: string; objects: number; bytes: number; uploadMs: number; attempts: number };
export type UploadIo = {
  syncPart: (part: string) => void | Promise<void>;
  listPart: (part: string) => RemoteObject[] | Promise<RemoteObject[]>;
  /** Keys and common prefixes (`part-01/`) directly under the run prefix, relative to it. */
  listRoot: () => RootListing | Promise<RootListing>;
  removePrefix: (prefix: string) => void | Promise<void>;
};

const MAX_ATTEMPTS = 4;
/** Wait before attempt 2, 3 and 4 (~3.5 min in all): long enough for a brief network degradation to pass. */
export const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];
const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const SHOWN_KEYS = 5;

export async function expectedPartObjects(partDir: string): Promise<RemoteObject[]> {
  const manifestPath = join(partDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { media?: { object_key: string; size_bytes: number | string }[] };
  const expected: RemoteObject[] = [{ key: "manifest.json", size: (await stat(manifestPath)).size }];
  for (const media of manifest.media ?? []) {
    const key = `media/${media.object_key}`;
    const size = Number(media.size_bytes);
    const local = await stat(join(partDir, key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error(`${partDir}: media file ${key} listed in the manifest is missing`);
      throw error;
    });
    if (local.size !== size) throw new Error(`${partDir}: media file ${key} is ${local.size} bytes, the manifest says ${size}`);
    expected.push({ key, size });
  }
  return expected;
}

export function checkPartUpload(expected: RemoteObject[], listed: RemoteObject[]): PartCheck {
  const remote = new Map(listed.map(object => [object.key, object.size]));
  const wanted = new Set(expected.map(object => object.key));
  const missing: string[] = [], sizeMismatch: string[] = [];
  for (const object of expected) {
    const size = remote.get(object.key);
    if (size === undefined) missing.push(object.key);
    else if (size !== object.size) sizeMismatch.push(object.key);
  }
  return { missing, sizeMismatch, unexpected: listed.map(object => object.key).filter(key => !wanted.has(key)) };
}

/** `Contents[].[Key,Size]` output (null when the prefix is empty) → objects relative to `base` (`<prefix>/<part>/`). */
export function parsePartListing(raw: [string, number][] | null, base: string): RemoteObject[] {
  return (raw ?? []).map(([key, size]) => ({ key: key.slice(base.length), size }));
}

/** `{keys, prefixes}` output (null fields when empty) → entries relative to `prefix`; the zero-byte folder marker (the prefix itself) is dropped. */
export function parseRootListing(raw: { keys: string[] | null; prefixes: string[] | null } | null, prefix: string): RootListing {
  const base = `${prefix}/`;
  return {
    keys: (raw?.keys ?? []).filter(key => key !== base).map(key => key.slice(base.length)),
    prefixes: (raw?.prefixes ?? []).map(entry => entry.slice(base.length)),
  };
}

const isClean = (check: PartCheck) => !check.missing.length && !check.sizeMismatch.length && !check.unexpected.length;

/** Anything directly under the run prefix that is not one of this run's `part-NN/` directories. */
export function strayEntries(parts: string[], listedPrefixes: string[], rootKeys: string[]): string[] {
  const own = new Set(parts.map(part => `${part}/`));
  return [...listedPrefixes.filter(prefix => !own.has(prefix)), ...rootKeys];
}

export function uploadFailure(part: string, check: PartCheck): string | null {
  if (isClean(check)) return null;
  const classes = (Object.entries({ missing: check.missing, "size mismatch": check.sizeMismatch, unexpected: check.unexpected }))
    .filter(([, keys]) => keys.length)
    .map(([label, keys]) => `${keys.length} ${label} (${keys.slice(0, SHOWN_KEYS).join(", ")}${keys.length > SHOWN_KEYS ? ", ..." : ""})`);
  return `Upload of ${part} is incomplete: ${classes.join("; ")}; the import was not started; the watermark stays`;
}

export async function uploadParts({ partsDir, parts, io, log, now = Date.now, sleep = defaultSleep }: {
  partsDir: string; parts: string[]; io: UploadIo; log: (line: string) => void; now?: () => number; sleep?: (ms: number) => Promise<void>;
}): Promise<PartStats[]> {
  const before = await io.listRoot();
  if (before.keys.length) throw new Error(`Unexpected objects directly under the run prefix: ${before.keys.slice(0, SHOWN_KEYS).join(", ")}; the import was not started; the watermark stays`);
  for (const prefix of strayEntries(parts, before.prefixes, [])) await io.removePrefix(prefix);

  const stats: PartStats[] = [];
  for (const part of parts) {
    const expected = await expectedPartObjects(join(partsDir, part));
    const started = now();
    let attempts = 0;
    let check: PartCheck | null = null;
    let syncError: unknown = null;
    // A part is retried on a silent drop (sync exits 0 but the listing is short) and on a failed sync (non-zero `aws s3 sync`
    // exit, e.g. a brief network outage), both within one budget with a growing wait (#1326). `s3 sync` only uploads missing
    // or changed files, so repeating it is cheap and safe. Verification is key + size only: in the fixed `current` layout a
    // stale object of the same size passes; a run prefix (STOREFRONT_SYNC_PREFIX_MODE=run, #1137) starts empty, so nothing
    // stale is there to pass.
    for (;;) {
      attempts += 1;
      syncError = null;
      check = null;
      try {
        await io.syncPart(part);
        check = checkPartUpload(expected, await io.listPart(part));
      } catch (error) {
        syncError = error;
      }
      if (check && isClean(check)) break;
      if (attempts >= MAX_ATTEMPTS) break;
      const waitMs = RETRY_DELAYS_MS[attempts - 1];
      const reason = check
        ? `incomplete listing: ${check.missing.length} missing, ${check.sizeMismatch.length} size mismatch, ${check.unexpected.length} unexpected`
        : `sync failed: ${(syncError instanceof Error ? syncError.message : String(syncError)).split("\n")[0]}`;
      log(JSON.stringify({ retry: part, attempt: attempts, reason, waitMs }));
      await sleep(waitMs);
    }
    if (syncError) {
      const message = syncError instanceof Error ? syncError.message : String(syncError);
      throw new Error(`Upload of ${part} failed after ${attempts} attempts: ${message}; the import was not started; the watermark stays`);
    }
    const failure = check ? uploadFailure(part, check) : null;
    if (failure) throw new Error(failure);
    const entry = { part, objects: expected.length, bytes: expected.reduce((sum, object) => sum + object.size, 0), uploadMs: now() - started, attempts };
    log(JSON.stringify(entry));
    stats.push(entry);
  }

  const after = await io.listRoot();
  const stray = strayEntries(parts, after.prefixes, after.keys);
  if (stray.length) throw new Error(`Unexpected entries under the run prefix after the upload: ${stray.slice(0, SHOWN_KEYS).join(", ")}; the import was not started; the watermark stays`);
  return stats;
}

// Run prefixes (#1137): with STOREFRONT_SYNC_PREFIX_MODE=run every run uploads to its own
// `storefront/current/run-<snapshotAt>/` and the import task is pointed at it, so objects of an earlier run can never be
// imported. The import script takes the prefix as an argument, so every deployed operations image handles it. Run
// prefixes stay under `storefront/current/` because the sync role may list/put/delete only there; the import report then
// lands at `internal/storefront-sync/storefront/current/run-…/report.json`, which the role can read only after the
// infra change widening `ReadImportReport` (docs/product-enrichment.md). Until then the default stays `current`.

/** Where the parts of every run live, and the only prefix the sync role may write to. */
export const SYNC_BASE_PREFIX = "storefront/current";
/** Run prefixes kept after a successful import, the current one included. */
export const KEEP_RUNS = 2;
const RUN_DIR = /^run-\d{8}T\d{9}Z\/$/;
const LEGACY_PART_DIR = /^part-\d+\/$/;

export type PrefixMode = "current" | "run";

/** STOREFRONT_SYNC_PREFIX_MODE: unset or `current` (one fixed prefix), `run` (a prefix per run); anything else is an error. */
export function parsePrefixMode(value: string | undefined): PrefixMode {
  if (value === undefined || value === "" || value === "current") return "current";
  if (value === "run") return "run";
  throw new Error(`STOREFRONT_SYNC_PREFIX_MODE must be current or run: ${value}`);
}

/** `run-20261121T085201308Z` for snapshotAt 2026-11-21T08:52:01.308Z; sorts in time order. */
export function runDirName(snapshotAt: string) {
  const at = new Date(snapshotAt);
  if (Number.isNaN(at.getTime())) throw new Error(`Invalid snapshotAt for a run prefix: ${snapshotAt}`);
  return `run-${at.toISOString().replace(/[-:.]/g, "")}`;
}

/**
 * Entries directly under SYNC_BASE_PREFIX (`part-01/`, `run-…/`) to remove after the import of `current` succeeded: parts
 * of the fixed-prefix layout and older runs beyond the newest `keep - 1`. The current run, runs newer than it and
 * anything that is neither a part nor a run directory are never returned.
 */
export function staleRunEntries(listedPrefixes: string[], current: string, keep = KEEP_RUNS): string[] {
  const own = `${current}/`;
  if (!RUN_DIR.test(own)) throw new Error(`Not a run directory: ${current}`);
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`keep must be a positive integer: ${keep}`);
  const older = listedPrefixes.filter(entry => RUN_DIR.test(entry) && entry < own).sort().reverse();
  return [...listedPrefixes.filter(entry => LEGACY_PART_DIR.test(entry)), ...older.slice(keep - 1)];
}

/**
 * The AWS config with `max_concurrent_requests` set in the `s3` block of `profile` (STOREFRONT_SYNC_S3_CONCURRENCY): the sync
 * writes it to a temporary file and points only its own `aws s3` calls at it (AWS_CONFIG_FILE), ~/.aws/config is untouched.
 * Other settings of an existing `s3` block are kept.
 */
export function withS3Concurrency(config: string, profile: string, concurrency: number) {
  const lines = config.split("\n");
  const header = lines.findIndex(line => line.trim() === `[profile ${profile}]`);
  if (header < 0) throw new Error(`[profile ${profile}] is not in the AWS config`);
  const next = lines.findIndex((line, index) => index > header && /^\s*\[/.test(line));
  const end = next < 0 ? lines.length : next;
  const section: string[] = [];
  let s3Line = -1;
  let inS3 = false;
  for (const line of lines.slice(header + 1, end)) {
    if (/^s3\s*=\s*$/.test(line)) { inS3 = true; s3Line = section.length; section.push(line); continue; }
    if (inS3 && /^\s+\S/.test(line)) { if (!/^\s+max_concurrent_requests\s*=/.test(line)) section.push(line); continue; }
    inS3 = false;
    section.push(line);
  }
  const setting = `  max_concurrent_requests = ${concurrency}`;
  if (s3Line < 0) section.unshift("s3 =", setting);
  else section.splice(s3Line + 1, 0, setting);
  return [...lines.slice(0, header + 1), ...section, ...lines.slice(end)].join("\n");
}
