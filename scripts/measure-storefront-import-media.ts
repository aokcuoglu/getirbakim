import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { isolatedSchema } from "./isolated-schema";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { type S3Stub, startS3Stub, stubEnv } from "./storefront-s3-stub";

// Measures what a part-00 full of vehicle images costs import-storefront-bundle.ts (#1406): S3 requests, wall time and the
// longest database transaction, on a cold target bucket and again on a warm one. Local only (not in CI): two isolated schemas
// (source, target) and two loopback S3 stubs, nothing shared is written. The part is built by the real pipeline: N media objects
// of --object-bytes random bytes and --rows vehicle images over them (the 2026-11-25 local data: 26,617 image rows on 4,009
// objects of ~17.5 KB) are exported by export-storefront-bundle.ts and cut by splitStorefrontBundle. The longest transaction is
// polled from pg_stat_activity every 100 ms (the import's sessions carry the target schema as application_name), so it reads
// up to ~100 ms short. One JSON line per import.
//
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/measure-storefront-import-media.ts \
//     [--objects=4000] [--rows=<objects>] [--object-bytes=17500] [--latency-ms=0] [--importer=scripts/import-storefront-bundle.ts]
//
// --latency-ms delays every response of the target's stub (a round trip to S3). To measure an earlier importer, write it under
// scripts/ (e.g. `git show <commit>:scripts/import-storefront-bundle.ts > scripts/import-storefront-bundle.before.ts`), pass
// --importer=scripts/import-storefront-bundle.before.ts and delete the file afterwards.

const repoRoot = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);
const FLAGS = ["objects", "rows", "object-bytes", "latency-ms", "importer"];
const unknown = process.argv.slice(2).filter(arg => !FLAGS.some(name => arg.startsWith(`--${name}=`)));
if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(" ")}`);
const flag = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const integer = (name: string, fallback: number, min: number) => {
  const value = flag(name);
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min) throw new Error(`--${name} must be an integer of at least ${min}: ${value}`);
  return Number(value);
};
const objects = integer("objects", 4000, 1);
const rows = integer("rows", objects, objects);
const objectBytes = integer("object-bytes", 17_500, 1);
const latencyMs = integer("latency-ms", 0, 0);
const importerPath = resolve(repoRoot, flag("importer") ?? "scripts/import-storefront-bundle.ts");
if (!importerPath.startsWith(resolve(repoRoot, "scripts") + sep) || !existsSync(importerPath)) throw new Error("--importer must name an existing file under scripts/");
const importer = relative(repoRoot, importerPath);

type Schema = Awaited<ReturnType<typeof isolatedSchema>>;
const srcBucket = `measure-src-${randomBytes(4).toString("hex")}`;
const dstBucket = `measure-dst-${randomBytes(4).toString("hex")}`;

/** Runs a script as a child process against one schema and one stub; checked first so it can reach nothing else (as test-storefront-e2e.ts run()). */
async function run(script: string, args: string[], schema: Schema, url: string, stub: S3Stub, bucket?: string) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("AWS_") || name.startsWith("S3_")) delete env[name];
  Object.assign(env, { DATABASE_URL: url, ...stubEnv(stub.url), PGAPPNAME: schema.name });
  if (bucket) env.S3_BUCKET = bucket;
  assert.match(env.S3_ENDPOINT!, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(new URL(env.DATABASE_URL!).searchParams.get("options"), `-c search_path=${schema.name},public`);
  try {
    return (await execFileAsync(process.execPath, ["--conditions=react-server", "--import", "tsx", script, ...args],
      { cwd: repoRoot, env, encoding: "utf8", maxBuffer: 1 << 26, timeout: 3_600_000, killSignal: "SIGKILL" })).stdout;
  } finally {
    assert.deepEqual(stub.unsupported, [], "the S3 stub got a request it does not support");
  }
}

/** Polls the longest open transaction of the sessions named `application` until the returned stop function is called. */
function longestTransaction(pool: Pool, application: string) {
  let longest = 0, stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const { rows: [row] } = await pool.query<{ ms: number | null }>(`SELECT max(EXTRACT(EPOCH FROM clock_timestamp()-xact_start)*1000)::float8 AS ms
        FROM pg_stat_activity WHERE application_name=$1 AND xact_start IS NOT NULL`, [application]);
      longest = Math.max(longest, row.ms ?? 0);
      await new Promise(done => setTimeout(done, 100));
    }
  })();
  return async () => { stopped = true; await loop; return Math.round(longest); };
}

/** One brand and model with --rows vehicle types, on either side (an image whose type is missing on the target would be skipped). */
async function seedVehicleTypes(pool: Pool) {
  await pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'FORD','FORD');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'FOCUS')`);
  await pool.query(`INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text)
    SELECT g,10,'1.6',1596,'Petrol','Benzin',105,77,'2004-01-01','2010-12-01','1.6' FROM generate_series(1,$1::int) g`, [rows]);
}

/** --objects media rows and stub objects on the source, and --rows vehicle images spread over them. */
async function seedSourceMedia(pool: Pool, stub: S3Stub) {
  const ids: string[] = [], keys: string[] = [], shas: string[] = [];
  for (let index = 0; index < objects; index++) {
    const bytes = randomBytes(objectBytes), sha = createHash("sha256").update(bytes).digest("hex");
    const key = `vehicle-types/${sha.slice(0, 2)}/${sha}.webp`;
    stub.objects.set(`${srcBucket}/${key}`, { bytes, contentType: "image/webp" });
    ids.push(randomUUID()); keys.push(key); shas.push(sha);
  }
  await pool.query(`INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url)
    SELECT id,$1,key,sha,'image/webp',$2,'https://example.com/'||sha FROM unnest($3::uuid[],$4::text[],$5::text[]) u(id,key,sha)`, [srcBucket, objectBytes, ids, keys, shas]);
  await pool.query(`INSERT INTO vehicle_type_images(vehicle_type_id,media_id,width,height)
    SELECT g,($1::uuid[])[(g-1)%cardinality($1::uuid[])+1],640,320 FROM generate_series(1,$2::int) g`, [ids, rows]);
}

let source: Schema | undefined, target: Schema | undefined, dir = "";
let sourceStub: S3Stub | undefined, targetStub: S3Stub | undefined;
try {
  dir = await mkdtemp(join(tmpdir(), "storefront-media-measure-"));
  sourceStub = await startS3Stub();
  targetStub = await startS3Stub({ latencyMs });
  source = await isolatedSchema("storefront_measure_src");
  const sourceUrl = process.env.DATABASE_URL!;
  target = await isolatedSchema("storefront_measure_dst");
  const targetUrl = process.env.DATABASE_URL!;
  await seedVehicleTypes(source.pool);
  await seedVehicleTypes(target.pool);
  await seedSourceMedia(source.pool, sourceStub);

  const full = join(dir, "full");
  await run("scripts/export-storefront-bundle.ts", [full], source, sourceUrl, sourceStub);
  const [part] = await splitStorefrontBundle(full, join(dir, "parts"), { mediaBytes: 1e9, jsonBytes: 1e9 });
  const manifest = JSON.parse(await readFile(join(part, "manifest.json"), "utf8")) as { media: unknown[]; vehicleImages: unknown[] };
  assert.deepEqual([manifest.media.length, manifest.vehicleImages.length], [objects, rows], "part-00 does not carry the seeded media");

  for (const phase of ["cold", "warm"] as const) {
    for (const list of [targetStub.puts, targetStub.gets, targetStub.heads]) list.length = 0;
    const reportFile = join(dir, `${phase}.report.json`);
    const stop = longestTransaction(target.pool, target.name);
    const started = performance.now();
    const stdout = await run(importer, [part, "--apply", `--report=${reportFile}`], target, targetUrl, targetStub, dstBucket);
    const wallMs = Math.round(performance.now() - started);
    const longestTransactionMs = await stop();
    const { report } = JSON.parse(await readFile(reportFile, "utf8")) as { report: Record<string, number | undefined> };
    const logged = stdout.match(/mediaMs: (\d+), transactionMs: (\d+)/);
    assert.equal([...targetStub.objects.keys()].filter(path => path.startsWith(`${dstBucket}/`)).length, objects, "the target bucket does not hold every object");
    console.log(JSON.stringify({
      importer, phase, objects, rows, objectBytes, latencyMs, wallMs, longestTransactionMs,
      importerMediaMs: logged ? Number(logged[1]) : null, importerTransactionMs: logged ? Number(logged[2]) : null,
      puts: targetStub.puts.length, gets: targetStub.gets.length, heads: targetStub.heads.length,
      mediaUploaded: report.mediaUploaded ?? null, mediaReadBack: report.mediaReadBack ?? null, mediaVerified: report.mediaVerified ?? null,
    }));
  }
} finally {
  // The schemas restore DATABASE_URL in nested order, so they are dropped innermost first.
  try { await target?.drop(); } finally {
    try { await source?.drop(); } finally {
      try { await targetStub?.close(); await sourceStub?.close(); } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
    }
  }
}
