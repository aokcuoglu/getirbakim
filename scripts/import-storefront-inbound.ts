import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { drainSharedLinks } from "./enrichment-derived-sync";
import { buildInboundReport, type PartReport, reportKey } from "./storefront-sync-state";
import { objectStorage } from "../src/lib/object-storage";

// Import side of sync-storefront-production.ts. Runs in the operations task, reads the parts that the sync uploaded
// to s3://$INBOUND_BUCKET/<prefix>/<part>/ and, in order:
// dry-run every part → apply every part → rebuild the fitments of the products the parts wrote → drain the derived enrichment tables → write
// s3://$S3_BUCKET/internal/storefront-sync/<prefix>/report.json (the media bucket: the task may only read the inbound
// one; summed counts and the supplier items whose enrichments were skipped because they do not exist
// here; the sync downloads it and sends those enrichments again next run). A failed dry run stops before anything is written.
// Parts are downloaded one at a time, so task storage holds a single part (≤ ~100 MB of media) at a time.
//
// Usage: node --conditions=react-server --import tsx scripts/import-storefront-inbound.ts <prefix>
//   e.g. storefront/current, or a run prefix storefront/current/run-20261121T085201308Z (STOREFRONT_SYNC_PREFIX_MODE=run, #1137)
// No pre-import backup is taken: RDS point-in-time recovery (7 days) covers it.
//
// Table decisions (#553; the full table is in docs/product-enrichment.md):
// - carried in the bundle: enrichments, mappings, media, categories, logos, REPXPERT vehicle data and the
//   complete/partial product_enrichment_jobs (sent whole in part-00 every run; the storefront needs the job status).
// - derived here, after the parts: product_vehicle_fitments (rebuild-product-fitments.ts --items: the supplier items the
//   parts wrote plus rows of an older matcher version), product_enrichment_shared_links
//   and storefront_make_fits / storefront_model_fits / storefront_make_description_fits (the shared-link queue the import filled is drained below), enrichment_product_states
//   (enrichment-states.ts sync). product_model_fitments comes from production's own Dinamik items, not from this sync.
// - tombstones (#564): enrichments deleted locally are deleted here by part-00 (storefront-bundle-tombstones.ts);
//   invalidated jobs are only counted.
// - not carried: vehicle_type_oil_specs (data/vehicle_type_oil_specs.csv + db:vehicle-oils), vehicle_type_trodo_oils,
//   product_enrichment_sources.
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

// The bundle import needs the react-server condition, the fitment rebuild does not.
function node(flags: string[], script: string, args: string[]) {
  const result = spawnSync(process.execPath, [...flags, "--import", "tsx", script, ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${script} ${args.join(" ")} failed with exit code ${result.status}`);
}

// The import's triggers queued the products it touched; the app drains that queue every few seconds, but the task
// must not finish before the storefront tables are current (scripts/enrichment-derived-sync.ts).
async function drainDerived() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { console.log(JSON.stringify(await drainSharedLinks(pool))); } finally { await pool.end(); }
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
  const applied: PartReport[] = [];
  let snapshotAt: string | null = null;
  for (const apply of [false, true]) {
    for (const part of parts) {
      const dir = resolve(work, "part");
      const reportFile = resolve(work, "part-report.json");
      await rm(dir, { recursive: true, force: true });
      await rm(reportFile, { force: true });
      await download(part, dir);
      node(["--conditions=react-server"], "scripts/import-storefront-bundle.ts", [dir, ...(apply ? ["--apply", `--report=${reportFile}`] : [])]);
      if (apply) {
        snapshotAt ??= (JSON.parse(await readFile(resolve(dir, "manifest.json"), "utf8")) as { snapshotAt?: string }).snapshotAt ?? null;
        applied.push(JSON.parse(await readFile(reportFile, "utf8")) as PartReport);
      }
    }
  }
  // Only the products the parts wrote (and any built by an older matcher); the rest of the table is already current.
  const fitmentItems = resolve(work, "fitment-items.json");
  // A part report without items (an import older than #561) would silently rebuild nothing; stop instead (the data is
  // committed, but the task fails, so the sync keeps its watermark and re-sends).
  const missingItems = applied.findIndex(part => !Array.isArray(part.items));
  if (missingItems >= 0) throw new Error(`The report of applied part ${missingItems + 1} has no items array; the fitment rebuild has no scope.`);
  await writeFile(fitmentItems, JSON.stringify([...new Set(applied.flatMap(part => part.items ?? []))]));
  node([], "scripts/rebuild-product-fitments.ts", [`--items=${fitmentItems}`]);
  await drainDerived();
  node([], "scripts/enrichment-states.ts", ["sync"]);
  // The data is committed by now, but without the report the sync cannot know what was skipped: the task fails, so
  // the sync keeps its watermark and the next run re-sends (idempotent). Each run overwrites the report.
  const report = { snapshotAt, ...buildInboundReport(applied) };
  console.log(JSON.stringify({ report: { ...report, skipped: report.skipped.length } }));
  const mediaBucket = process.env.S3_BUCKET;
  if (!mediaBucket) throw new Error("S3_BUCKET required for report.json");
  await storage.send(new PutObjectCommand({ Bucket: mediaBucket, Key: reportKey(prefix), Body: JSON.stringify(report), ContentType: "application/json" }));
} finally {
  await rm(work, { recursive: true, force: true });
}
