import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { isolatedSchema } from "./isolated-schema";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { REMOVED_JOB_ERROR } from "./storefront-bundle-tombstones";
import { buildInboundReport, type PartReport } from "./storefront-sync-state";

// The storefront sync end to end (#1372): export-storefront-bundle.ts -> splitStorefrontBundle -> import-storefront-bundle.ts, each
// a real child process, between two isolated copies of the schema (a local database as source, production as target) and an
// in-test S3 stub. It checks what the pieces' own tests cannot: that every column an exporter SELECT or importer INSERT carries
// reaches the target unchanged. Whatever may legitimately differ is listed in LOCAL_ONLY, with its reason; anything else that
// differs fails. A column nobody seeded fails assertColumnCoverage, so a new column cannot pass by being empty on both sides.
const skip = !process.env.DATABASE_URL && "DATABASE_URL not set";
if (process.env.CI && skip) throw new Error("DATABASE_URL is required in CI: the storefront e2e test must not be skipped silently");

const repoRoot = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

/** The only columns that may differ between the source and the target after an import, per carried table. */
export const LOCAL_ONLY = {
  source_categories: {},
  source_category_labels: {},
  source_category_images: {},
  product_media_objects: {
    id: "ids are per database; rows are compared by sha256",
    bucket: "the importer rewrites it to the target's S3_BUCKET",
    stored_at: "set by the target's own import/gc bookkeeping, not carried",
  },
  product_enrichments: {},
  product_enrichment_jobs: {
    attempts: "the importer writes 1: attempts count the local worker's tries",
    last_error: "a local worker error; the importer clears it (and a tombstone sets its own)",
    created_at: "row creation time on each database",
    updated_at: "the importer's write time",
  },
  product_source_categories: {},
  manufacturer_logos: {},
  vehicle_type_specs: { payload: "the raw REPXPERT response stays local" },
  vehicle_type_images: { original_media_id: "the cut-out's origin (media row of the REPXPERT original) is not carried" },
} as const satisfies Record<string, Record<string, string>>;
type CarriedTable = keyof typeof LOCAL_ONLY;
const TABLES = Object.keys(LOCAL_ONLY) as CarriedTable[];
const TYPE_NOT_ON_TARGET = 104;

// One compared row per table: to_jsonb of the row without its LOCAL_ONLY columns, ids replaced by keys that are the same on both
// databases (supplier item code, media sha256). `where` is the part of the table the export carries; $1 is the codes to leave out.
const sqlCode = (column: string) => `(SELECT code FROM supplier_items WHERE id=t.${column})`;
const sqlSha = (column: string) => `(SELECT sha256 FROM product_media_objects WHERE id=t.${column})`;
const enriched = "EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=t.supplier_item_id)";
const notExcluded = `NOT (${sqlCode("supplier_item_id")}=ANY($1::text[]))`;
const SPECS: Record<CarriedTable, { select: string; where?: string; order: string }> = {
  source_categories: { select: "to_jsonb(t)", order: "t.source,t.category_id" },
  source_category_labels: { select: "to_jsonb(t)", order: "t.source,t.category_id,t.locale" },
  source_category_images: { select: `to_jsonb(t)-'media_id'||jsonb_build_object('media_sha256',${sqlSha("media_id")})`, order: "t.source,t.category_id" },
  product_media_objects: { select: "to_jsonb(t)", order: "t.sha256" },
  product_enrichments: {
    select: `to_jsonb(t)-'supplier_item_id'-'image_id'||jsonb_build_object('code',${sqlCode("supplier_item_id")},'image_sha256',${sqlSha("image_id")})`,
    where: notExcluded, order: sqlCode("supplier_item_id"),
  },
  product_enrichment_jobs: {
    select: `to_jsonb(t)-'supplier_item_id'||jsonb_build_object('code',${sqlCode("supplier_item_id")})`,
    where: `t.status IN ('complete','partial') AND ${enriched} AND ${notExcluded}`, order: sqlCode("supplier_item_id"),
  },
  product_source_categories: {
    select: `to_jsonb(t)-'supplier_item_id'||jsonb_build_object('code',${sqlCode("supplier_item_id")})`,
    where: `${enriched} AND ${notExcluded}`, order: `${sqlCode("supplier_item_id")},t.source,t.category_id`,
  },
  manufacturer_logos: {
    select: `to_jsonb(t)-'evidence_product_id'||jsonb_build_object('evidence_code',${sqlCode("evidence_product_id")})`, order: "t.brand_key",
  },
  vehicle_type_specs: { select: "to_jsonb(t)", where: `t.outcome<>'error' AND t.vehicle_type_id<>${TYPE_NOT_ON_TARGET}`, order: "t.vehicle_type_id" },
  vehicle_type_images: {
    select: `to_jsonb(t)-'media_id'||jsonb_build_object('media_sha256',${sqlSha("media_id")})`, where: `t.vehicle_type_id<>${TYPE_NOT_ON_TARGET}`, order: "t.vehicle_type_id",
  },
};
type Queryable = Pick<Pool, "query">;
async function compareRows(table: CarriedTable, db: Queryable, excludeCodes: string[]) {
  const spec = SPECS[table];
  const dropped = Object.keys(LOCAL_ONLY[table]);
  const sql = `SELECT (${spec.select})-$2::text[] AS row FROM ${table} t WHERE $1::text[] IS NOT NULL ${spec.where ? `AND ${spec.where}` : ""} ORDER BY ${spec.order}`;
  return (await db.query<{ row: Record<string, unknown> }>(sql, [excludeCodes, dropped])).rows.map(entry => entry.row);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// An S3 stub: path-style GET/PUT of whole objects on 127.0.0.1, nothing else. Anything it does not understand answers 501 and is recorded.
type Stub = Awaited<ReturnType<typeof startS3Stub>>;
async function startS3Stub() {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const state = { puts: [] as string[], unsupported: [] as string[] };
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0].split("/").filter(Boolean).map(segment => decodeURIComponent(segment)).join("/");
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const fail = (status: number, code: string) => { res.writeHead(status, { "Content-Type": "application/xml" }); res.end(`<Error><Code>${code}</Code></Error>`); };
      if (req.headers["content-encoding"]?.includes("aws-chunked") || String(req.headers["x-amz-content-sha256"] ?? "").startsWith("STREAMING-")) {
        state.unsupported.push(`${req.method} ${path} (aws-chunked)`);
        return fail(501, "NotImplemented");
      }
      if (req.method === "GET") {
        const object = objects.get(path);
        if (!object) return fail(404, "NoSuchKey");
        res.writeHead(200, { "Content-Length": object.bytes.length, "Content-Type": object.contentType, ETag: `"${createHash("md5").update(object.bytes).digest("hex")}"` });
        return void res.end(object.bytes);
      }
      if (req.method === "PUT") {
        const bytes = Buffer.concat(chunks);
        objects.set(path, { bytes, contentType: String(req.headers["content-type"] ?? "application/octet-stream") });
        state.puts.push(path);
        res.writeHead(200, { ETag: `"${createHash("md5").update(bytes).digest("hex")}"`, "Content-Length": 0 });
        return void res.end();
      }
      state.unsupported.push(`${req.method} ${path}`);
      fail(501, "NotImplemented");
    });
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("S3 stub has no port");
  return {
    url: `http://127.0.0.1:${address.port}`, objects, ...state,
    close: () => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
type Schema = Awaited<ReturnType<typeof isolatedSchema>>;
let source: Schema, target: Schema;
let sourceUrl = "", targetUrl = "";
let stub: Stub;
let dir = "";
const srcBucket = `e2e-src-${randomBytes(4).toString("hex")}`;
const dstBucket = `e2e-dst-${randomBytes(4).toString("hex")}`;

/** Runs a bundle script as a child process against one schema and the stub; every spawn is checked first so it can reach nothing else. */
async function run(script: string, args: string[], side: "source" | "target") {
  const schema = side === "source" ? source : target;
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("AWS_") || name.startsWith("S3_")) delete env[name];
  Object.assign(env, {
    DATABASE_URL: side === "source" ? sourceUrl : targetUrl, S3_ENDPOINT: stub.url, S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test-secret",
    AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED", AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED",
  });
  if (side === "target") env.S3_BUCKET = dstBucket;
  assert.match(env.S3_ENDPOINT!, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(new URL(env.DATABASE_URL!).searchParams.get("options"), `-c search_path=${schema.name},public`);
  assert.ok(!args.some(arg => arg.startsWith("--env-file") || arg === "--prune"));
  try {
    return (await execFileAsync(process.execPath, ["--conditions=react-server", "--import", "tsx", `scripts/${script}`, ...args], { cwd: repoRoot, env, encoding: "utf8", maxBuffer: 1 << 26 })).stdout;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    throw new Error(`${script} failed: ${failure.message}\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`);
  } finally {
    assert.deepEqual(stub.unsupported, [], "the S3 stub got a request it does not support");
  }
}

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;
const readLines = async <T>(path: string) => (await readFile(path, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as T);
type ExportManifest = {
  snapshotAt: string; enrichmentCount: number; tombstones: { code: string; kind: string }[]; vehicleSpecs: unknown[]; vehicleImages: unknown[];
  vehicleData: { digest: string; specs: number; images: number; sent: boolean }; jobCount: number;
};
type PartManifest = { jobs: unknown[]; enrichments: unknown[]; vehicleData?: unknown; enrichmentsFile?: unknown };

// ---------------------------------------------------------------------------------------------------------------------------------
// Fixture.
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const CODES = ["E2E-A", "E2E-B", "E2E-C", "E2E-MISSING", "E2E-GONE", "E2E-PENDING"] as const;
type Code = (typeof CODES)[number];
const sourceId = Object.fromEntries(CODES.map(code => [code, randomUUID()])) as Record<Code, string>;
const mediaId = { mCat: randomUUID(), mA: randomUUID(), mMissing: randomUUID(), mGone: randomUUID(), mVeh: randomUUID() };
type MediaName = keyof typeof mediaId;
const mediaBytes = Object.fromEntries(Object.keys(mediaId).map(name => [name, randomBytes(64)])) as Record<MediaName, Buffer>;
const mediaSha = (name: MediaName) => sha256(mediaBytes[name]);
const mediaKey = (name: MediaName) => `e2e/${mediaSha(name)}.png`;
const day = (n: number) => `2026-01-${String(n).padStart(2, "0")}T10:00:00Z`;

async function insertItem(pool: Pool, id: string, code: string, warehouse = "MRK") {
  await pool.query(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
    VALUES($1,'basbug','C','L',$2,$3,'{}',1,0,0,$4,$4,$4)`, [id, warehouse, code, day(1)]);
}
async function insertVehicles(pool: Pool, withLast: boolean) {
  await pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'FORD','FORD');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'FOCUS')`);
  for (const id of [101, 102, 103, ...(withLast ? [104] : [])]) {
    await pool.query(`INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text)
      VALUES($1,10,'1.6',1596,'Petrol','Benzin',105,77,'2004-01-01','2010-12-01','1.6')`, [id]);
  }
}

async function seedSource(pool: Pool) {
  for (const code of CODES) await insertItem(pool, sourceId[code], code);
  for (const name of Object.keys(mediaId) as MediaName[]) {
    await pool.query(`INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url,created_at,stored_at) VALUES($1,$2,$3,$4,'image/png',64,$5,$6,$7)`,
      [mediaId[name], srcBucket, mediaKey(name), mediaSha(name), `https://example.com/${name}.png`, day(2), day(3)]);
    stub.objects.set(`${srcBucket}/${mediaKey(name)}`, { bytes: mediaBytes[name], contentType: "image/png" });
  }
  await pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw,fetched_at) VALUES
    ('trodo',1,NULL,'Motor','motor','{1}','https://example.com/c1','{"id":1}',$1),
    ('trodo',2,1,'Filtre','filtre','{1,2}','https://example.com/c2','{"id":2}',$1),
    ('otoparcasan',9,NULL,'Yag','yag','{9}','https://example.com/c9','{"id":9}',$1)`, [day(4)]);
  await pool.query(`INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES('trodo',2,'tr','Filtre','filtre'),('trodo',2,'en','Filter','filter')`);
  await pool.query("INSERT INTO source_category_images(source,category_id,media_id,width,height) VALUES('trodo',2,$1,320,240)", [mediaId.mCat]);
  const enrichment = (code: Code, image: string | null, basis: object, n: number) => pool.query(
    `INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload,imported_at,match_basis)
     VALUES($1,$2,$3,$4,'trodo',$5,$6,$7,$8,$9,$10)`,
    [sourceId[code], `SC-${code}`, `BRAND-${n}`, `https://example.com/p/${code}`, `MAN-${n}`, `PN-${n}`, image, { title: code, specs: [n] }, day(n), JSON.stringify(basis)]);
  await enrichment("E2E-A", mediaId.mA, { type: "oem", oem: "123" }, 5);
  await enrichment("E2E-B", mediaId.mA, { type: "cross", oem: "456" }, 6);
  await enrichment("E2E-C", null, { type: "exact_part" }, 7);
  await enrichment("E2E-MISSING", mediaId.mMissing, { type: "oem", oem: "789" }, 8);
  await enrichment("E2E-GONE", mediaId.mGone, { type: "oem", oem: "790" }, 9);
  const job = (code: Code, status: string, n: number) => pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,status,supplier_code,supplier_brand,oem,candidate_url,attempts,last_error,last_attempt_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,3,'x',$7,$8,$8)`, [sourceId[code], status, `SC-${code}`, `BRAND-${n}`, `OEM-${n}`, `https://example.com/cand/${code}`, day(n), day(1)]);
  await job("E2E-A", "complete", 10); await job("E2E-B", "complete", 11); await job("E2E-C", "partial", 12);
  await job("E2E-MISSING", "complete", 13); await job("E2E-GONE", "complete", 14); await job("E2E-PENDING", "pending", 15);
  for (const [code, source, category] of [["E2E-A", "trodo", 1], ["E2E-A", "trodo", 2], ["E2E-B", "otoparcasan", 9], ["E2E-GONE", "trodo", 2], ["E2E-MISSING", "trodo", 1]] as const) {
    await pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,$2,$3)", [sourceId[code], source, category]);
  }
  for (const [brand, code, n] of [["FEBI", "E2E-A", 1], ["MANN", "E2E-C", 2]] as const) {
    const bytes = randomBytes(32);
    await pool.query(`INSERT INTO manufacturer_logos(brand_key,manufacturer,image_data,sha256,width,height,source_url,evidence_product_id,evidence_source_url,imported_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [brand, `${brand} GmbH`, bytes, sha256(bytes), 80 + n, 20 + n, `https://example.com/logo/${brand}`, sourceId[code], `https://example.com/evidence/${brand}`, day(20 + n)]);
  }
  await insertVehicles(pool, true);
  await pool.query(`INSERT INTO vehicle_type_specs(vehicle_type_id,outcome,detail,full_name,body_type,drive_type,engine_type,fuel_mixture,cylinders,valves,engine_codes,kba_numbers,payload,fetched_at) VALUES
    (101,'found','spec detail','Ford Focus 1.6','Hatchback','FWD','Petrol','Injection',4,16,'{A16,B16}','{8253,AAA}','{"raw":true}',$1),
    (102,'missing','not known to REPXPERT',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}','{}',NULL,$1),
    (103,'error','timeout',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}','{}',NULL,$1),
    (104,'found','other detail','Ford Focus 1.8','Estate','RWD','Diesel','Direct',4,8,'{C18}','{1234}','{"raw":2}',$1)`, [day(25)]);
  await pool.query(`INSERT INTO vehicle_type_images(vehicle_type_id,media_id,width,height,imported_at,original_media_id) VALUES(101,$1,640,320,$2,$3)`, [mediaId.mVeh, day(26), mediaId.mCat]);
}

async function seedTarget(pool: Pool) {
  // Different ids on the target; E2E-C keeps its id but sits in another warehouse (the id fallback); E2E-MISSING is not listed there yet.
  for (const code of CODES) {
    if (code === "E2E-MISSING") continue;
    if (code === "E2E-C") await insertItem(pool, sourceId[code], code, "MRK2");
    else await insertItem(pool, randomUUID(), code);
  }
  await insertVehicles(pool, false);
}

// ---------------------------------------------------------------------------------------------------------------------------------
async function compareAll(excludeCodes: string[] = []) {
  for (const table of TABLES) {
    const [fromSource, fromTarget] = [await compareRows(table, source.pool, excludeCodes), await compareRows(table, target.pool, excludeCodes)];
    assert.ok(fromSource.length > 0 && fromTarget.length > 0, `${table}: the comparison is empty (source ${fromSource.length}, target ${fromTarget.length} rows)`);
    assert.deepEqual(fromTarget, fromSource, `${table} differs between source and target`);
  }
}

/** Every column of a carried table is either listed in LOCAL_ONLY or has a value in the fixture on both sides. */
async function assertColumnCoverage() {
  for (const table of TABLES) {
    const columns = (await source.pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
      [source.name, table])).rows.map(row => row.column_name);
    assert.ok(columns.length > 0, `${table} has no columns in the source schema`);
    for (const column of columns.filter(name => !(name in LOCAL_ONLY[table]))) {
      for (const [side, pool] of [["source", source.pool], ["target", target.pool]] as const) {
        const { rows } = await pool.query<{ filled: number }>(`SELECT count("${column}")::int AS filled FROM ${table}`);
        assert.ok(rows[0].filled > 0, `${table}.${column} is empty on the ${side}: seed ${table}.${column} in the fixture and carry it, or add it to LOCAL_ONLY with a reason`);
      }
    }
  }
}

before(async () => {
  if (skip) return;
  dir = await mkdtemp(join(tmpdir(), "storefront-e2e-"));
  stub = await startS3Stub();
  source = await isolatedSchema("storefront_e2e_src");
  sourceUrl = process.env.DATABASE_URL!;
  target = await isolatedSchema("storefront_e2e_dst");
  targetUrl = process.env.DATABASE_URL!;
  await seedSource(source.pool);
  await seedTarget(target.pool);
});
after(async () => {
  await target?.drop();
  await source?.drop();
  await stub?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const state: { digest: string; snapshotAt: string; skipped: unknown[]; vehicleSnapshot: unknown[] } = { digest: "", snapshotAt: "", skipped: [], vehicleSnapshot: [] };
const vehicleRows = async (pool: Pool) => [...(await compareRows("vehicle_type_specs", pool, [])), ...(await compareRows("vehicle_type_images", pool, []))];

async function importParts(parts: string[]) {
  const reports: PartReport[] = [];
  for (const part of parts) {
    const reportFile = `${part}.report.json`;
    await run("import-storefront-bundle.ts", [part, "--apply", `--report=${reportFile}`], "target");
    reports.push(await readJson<PartReport>(reportFile));
  }
  return reports;
}

test("an export reads the seeded media through the S3 stub", { skip }, async () => {
  const guard = join(dir, "single");
  assert.ok(stub.objects.has(`${srcBucket}/${mediaKey("mCat")}`));
  assert.equal((await run("export-storefront-bundle.ts", [guard], "source")).includes("Exported"), true);
  const manifest = await readJson<ExportManifest>(join(guard, "manifest.json"));
  assert.ok(manifest.enrichmentCount > 0);
  const bytes = await readFile(join(guard, "media", mediaKey("mCat")));
  assert.deepEqual(bytes, mediaBytes.mCat);
});

test("run 1: a full export, split, applied part by part, leaves the target equal to the source", { skip }, async () => {
  const full = join(dir, "full1");
  await run("export-storefront-bundle.ts", [full], "source");
  const manifest = await readJson<ExportManifest>(join(full, "manifest.json"));
  assert.equal(manifest.vehicleData.sent, true);
  assert.equal(manifest.vehicleData.specs, 3);
  assert.equal(manifest.vehicleData.images, 1);
  state.digest = manifest.vehicleData.digest;
  state.snapshotAt = manifest.snapshotAt;

  const size = (row: unknown) => Buffer.byteLength(JSON.stringify(row)) + 1;
  const jobs = await readLines<{ supplier_item_id: string }>(join(full, "jobs.ndjson"));
  const items = await readLines<{ id: string }>(join(full, "items.ndjson"));
  const unit = Math.max(...jobs.map(job => size(job) + size(items.find(item => item.id === job.supplier_item_id))));
  const parts = await splitStorefrontBundle(full, join(dir, "parts1"), { mediaBytes: 1e9, jsonBytes: unit * 2 });
  const manifests = await Promise.all(parts.map(part => readJson<PartManifest>(join(part, "manifest.json"))));
  assert.deepEqual(manifests.map(part => [part.jobs.length, part.enrichments.length]), [[0, 0], [2, 0], [2, 0], [1, 0], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]);
  assert.ok(manifests.every(part => !("vehicleData" in part) && !("enrichmentsFile" in part)));

  const reports = await importParts(parts);
  const inbound = buildInboundReport(reports);
  const { totals } = inbound;
  assert.deepEqual([totals.enrichments, totals.skippedEnrichments, totals.skippedJobs, totals.skippedVehicleSpecs, totals.tombstones],
    [4, 1, 1, 1, 0]);
  assert.ok(totals.itemsByKey > 0);
  assert.deepEqual(inbound.skipped.map(item => item.code), ["E2E-MISSING"]);
  state.skipped = inbound.skipped;

  await assertColumnCoverage();
  await compareAll(["E2E-MISSING"]);
  assert.equal((await target.pool.query("SELECT 1 FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id WHERE s.code='E2E-PENDING'")).rowCount, 0);
  const exported = await readLines<{ bucket: string; object_key: string }>(join(full, "media.ndjson"));
  assert.equal(exported.length, 5);
  for (const object of exported) {
    const stored = stub.objects.get(`${dstBucket}/${object.object_key}`);
    assert.ok(stored, `${object.object_key} is not in the target bucket`);
    assert.deepEqual(stored.bytes, stub.objects.get(`${srcBucket}/${object.object_key}`)!.bytes);
  }

  // Non-vacuity: a changed carried column must fail the comparison.
  const client = await target.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE product_enrichment_jobs SET candidate_url=NULL");
    await assert.rejects(async () => {
      assert.deepEqual(await compareRows("product_enrichment_jobs", client, ["E2E-MISSING"]), await compareRows("product_enrichment_jobs", source.pool, ["E2E-MISSING"]));
    });
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("run 2: a delta with a deletion and a retry applies, resets the removed job and leaves the unchanged vehicle data alone", { skip }, async () => {
  // Timestamps travel as JSON through a JS Date: milliseconds, so the edit is set at that precision.
  await source.pool.query("UPDATE product_enrichments SET payload='{\"title\":\"changed\"}',imported_at=date_trunc('milliseconds',now()) WHERE supplier_item_id=$1", [sourceId["E2E-A"]]);
  await source.pool.query("DELETE FROM product_enrichments WHERE supplier_item_id=$1", [sourceId["E2E-GONE"]]);
  await insertItem(target.pool, randomUUID(), "E2E-MISSING");
  const retry = join(dir, "retry.json");
  await writeFile(retry, JSON.stringify(state.skipped));
  stub.puts.length = 0;
  state.vehicleSnapshot = await vehicleRows(target.pool);

  const full = join(dir, "full2");
  await run("export-storefront-bundle.ts", [full, `--since=${state.snapshotAt}`, `--vehicle-digest=${state.digest}`, `--retry-file=${retry}`], "source");
  const manifest = await readJson<ExportManifest>(join(full, "manifest.json"));
  assert.equal(manifest.vehicleData.sent, false);
  assert.equal(manifest.vehicleData.digest, state.digest);
  assert.deepEqual([manifest.vehicleSpecs, manifest.vehicleImages], [[], []]);
  assert.equal(manifest.enrichmentCount, 2);
  assert.deepEqual(manifest.tombstones.map(row => [row.code, row.kind]), [["E2E-GONE", "enrichment_deleted"]]);
  assert.ok(!(await readLines<{ id: string }>(join(full, "media.ndjson"))).some(row => row.id === mediaId.mVeh));

  const parts = await splitStorefrontBundle(full, join(dir, "parts2"), { mediaBytes: 1e9, jsonBytes: 1e9 });
  assert.equal(parts.length, 3);
  const { totals } = buildInboundReport(await importParts(parts));
  assert.deepEqual([totals.removedEnrichments, totals.resetJobs, totals.enrichments, totals.skippedEnrichments], [1, 1, 2, 0]);
  assert.ok(!stub.puts.some(path => path.endsWith(mediaKey("mVeh"))), "the unchanged vehicle image was uploaded again");
  assert.deepEqual(await vehicleRows(target.pool), state.vehicleSnapshot);

  await compareAll();
  const gone = (await target.pool.query<{ status: string; last_error: string | null }>(
    "SELECT j.status,j.last_error FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id WHERE s.code='E2E-GONE'")).rows;
  assert.deepEqual(gone, [{ status: "pending", last_error: REMOVED_JOB_ERROR }]);
});

test("run 3: changed vehicle data is sent again whatever digest the target confirmed", { skip }, async () => {
  await source.pool.query("UPDATE vehicle_type_specs SET full_name='changed' WHERE vehicle_type_id=101");
  const full = join(dir, "full3");
  await run("export-storefront-bundle.ts", [full, `--vehicle-digest=${state.digest}`], "source");
  const manifest = await readJson<ExportManifest>(join(full, "manifest.json"));
  assert.equal(manifest.vehicleData.sent, true);
  assert.notEqual(manifest.vehicleData.digest, state.digest);
  assert.equal(manifest.vehicleSpecs.length, 3);
});
