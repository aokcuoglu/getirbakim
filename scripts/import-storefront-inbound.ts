import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { objectStorage } from "../src/lib/object-storage";

// AWS counterpart of the VPS steps in sync-storefront-production.ts. Runs in the operations task, reads the parts
// that the sync uploaded to s3://$INBOUND_BUCKET/<prefix>/<part>/ and does what the SSH steps did on the VPS:
// dry-run every part → apply every part → rebuild fitments. A failed dry run stops before anything is written.
// Parts are downloaded one at a time, so task storage holds a single part (≤ ~100 MB of media) at a time.
//
// Usage: node --conditions=react-server --import tsx scripts/import-storefront-inbound.ts <prefix>
//   e.g. storefront/current
// The pre-import backup of the VPS flow is covered on AWS by RDS point-in-time recovery (7 days).
const prefix = process.argv[2]?.replace(/^\/+|\/+$/g, "");
if (!prefix) throw new Error("Usage: import-storefront-inbound.ts <prefix>");
const bucket = process.env.INBOUND_BUCKET;
if (!bucket) throw new Error("INBOUND_BUCKET required");
const storage = objectStorage();

async function listKeys(listPrefix: string, delimiter?: string) {
  const keys: string[] = [], prefixes: string[] = [];
  let token: string | undefined;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: listPrefix, Delimiter: delimiter, ContinuationToken: token }));
    keys.push(...(page.Contents ?? []).map(object => object.Key!));
    prefixes.push(...(page.CommonPrefixes ?? []).map(common => common.Prefix!));
    token = page.NextContinuationToken;
  } while (token);
  return { keys, prefixes };
}

async function download(partPrefix: string, target: string) {
  const { keys } = await listKeys(partPrefix);
  if (!keys.some(key => key === `${partPrefix}manifest.json`)) throw new Error(`${partPrefix} has no manifest.json`);
  for (const key of keys) {
    const path = resolve(target, key.slice(partPrefix.length));
    if (!path.startsWith(target + sep)) throw new Error(`Unsafe object key: ${key}`);
    await mkdir(dirname(path), { recursive: true });
    const object = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    await pipeline(object.Body as Readable, createWriteStream(path));
  }
}

// Same invocations as production-task.sh on the VPS (the bundle import needs the react-server condition, the
// fitment rebuild does not).
function node(flags: string[], script: string, args: string[]) {
  const result = spawnSync(process.execPath, [...flags, "--import", "tsx", script, ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${script} ${args.join(" ")} failed with exit code ${result.status}`);
}

// Parts are named part-01, part-02, ... (split-storefront-bundle.ts) and are imported in numeric order
// (part-100 must follow part-99, which a plain string sort would not do).
const partNumber = (part: string) => Number(/part-(\d+)\/$/.exec(part)?.[1] ?? Number.NaN);
const parts = (await listKeys(`${prefix}/`, "/")).prefixes.filter(part => Number.isFinite(partNumber(part)))
  .sort((a, b) => partNumber(a) - partNumber(b));
if (parts.length === 0) throw new Error(`No bundle parts under s3://${bucket}/${prefix}/`);
console.log(JSON.stringify({ bucket, prefix, parts: parts.length }));

const work = await mkdtemp(join(tmpdir(), "storefront-"));
try {
  for (const apply of [false, true]) {
    for (const part of parts) {
      const dir = resolve(work, "part");
      await rm(dir, { recursive: true, force: true });
      await download(part, dir);
      node(["--conditions=react-server"], "scripts/import-storefront-bundle.ts", [dir, ...(apply ? ["--apply"] : [])]);
    }
  }
  node([], "scripts/rebuild-product-fitments.ts", []);
} finally {
  await rm(work, { recursive: true, force: true });
}
