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

const MAX_ATTEMPTS = 2;
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

export async function uploadParts({ partsDir, parts, io, log, now = Date.now }: {
  partsDir: string; parts: string[]; io: UploadIo; log: (line: string) => void; now?: () => number;
}): Promise<PartStats[]> {
  const before = await io.listRoot();
  const stale = strayEntries(parts, before.prefixes, []);
  for (const prefix of stale) await io.removePrefix(prefix);
  if (before.keys.length) throw new Error(`Unexpected objects directly under the run prefix: ${before.keys.slice(0, SHOWN_KEYS).join(", ")}; the import was not started; the watermark stays`);

  const stats: PartStats[] = [];
  for (const part of parts) {
    const expected = await expectedPartObjects(join(partsDir, part));
    const started = now();
    let attempts = 0;
    let check: PartCheck;
    do {
      attempts += 1;
      await io.syncPart(part);
      check = checkPartUpload(expected, await io.listPart(part));
    } while (!isClean(check) && attempts < MAX_ATTEMPTS);
    const failure = uploadFailure(part, check);
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
