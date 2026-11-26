import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import type { Pool } from "pg";
import type { z } from "zod";
import { enrichmentDataSchema } from "../src/modules/store/enrichment-contract";
import { isolatedSchema } from "./isolated-schema";
import { type S3Stub, startS3Stub, stubEnv } from "./storefront-s3-stub";
import { splitStorefrontBundle } from "./split-storefront-bundle";
import { REMOVED_JOB_ERROR } from "./storefront-bundle-tombstones";
import { buildInboundReport, checkInboundReport, type PartReport, reportKey } from "./storefront-sync-state";

// The storefront sync end to end (#1372): export-storefront-bundle.ts -> splitStorefrontBundle -> import-storefront-bundle.ts, each
// a real child process, between two isolated copies of the schema (a local database as source, production as target) and an
// S3 stub on 127.0.0.1 (storefront-s3-stub.ts: whole-object GET/HEAD/PUT with x-amz-meta-* metadata, listing). It checks what
// the pieces' own tests cannot: that every column an exporter SELECT or importer INSERT carries reaches the target unchanged,
// both when the row is new on the target (run 1) and when it already exists there and changes
// (run 2 changes every carried non-key column of one imported row per table, run 3 the vehicle data), so a column missing from an
// importer's INSERT or from its ON CONFLICT DO UPDATE list fails. Whatever may legitimately differ is listed in LOCAL_ONLY, with its
// reason; anything else that differs fails. The inbound tests (#1384) then run import-storefront-inbound.ts, the operations-task entry
// point, on a third isolated schema: the same parts through a listing-capable stub, all dry runs, apply, fitment rebuild, queue drain,
// report.json, and a part that fails its dry run must write nothing.
// The golden fixture of the part format (#1383) is compared with the rows the real export wrote: same keys, same JSON types per key.
// Run 3 also skips the category images and logos run 2 sent (--static-digest, #1379) and sends them again once a logo changes; run 4 imports media
// the target already holds under another id and object key (#1385): every referencing table must point at the existing object. Run 5
// imports run 4's parts again: an unchanged object costs one HEAD and no PUT or GET, a missing, truncated or metadata-less one is
// rewritten (#1406). Run 6 fails one upload: the part writes no row. INSERT_ONLY lists columns the importer writes on insert but
// never updates: they are left out of the comparisons that follow an update, so the gap stays visible. A column nobody seeded, or
// one that only ever holds its constant default, fails assertColumnCoverage, so a new column cannot pass by being empty or defaulted
// on both sides.
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
/** Columns the importer inserts but never updates on an existing row (the update-path comparisons skip them). */
export const INSERT_ONLY: Partial<Record<keyof typeof LOCAL_ONLY, Record<string, string>>> = {
  product_enrichment_jobs: {
    last_attempt_at: "storefront-bundle-jobs.ts never updates it: nothing on the target reads it (#1386)",
  },
};
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
type ExtraDropped = Partial<Record<CarriedTable, string[]>>;
async function compareRows(table: CarriedTable, db: Queryable, excludeCodes: string[], afterUpdate = false, extraDropped: ExtraDropped = {}) {
  const spec = SPECS[table];
  const dropped = [...Object.keys(LOCAL_ONLY[table]), ...(afterUpdate ? Object.keys(INSERT_ONLY[table] ?? {}) : []), ...(extraDropped[table] ?? [])];
  const sql = `SELECT (${spec.select})-$2::text[] AS row FROM ${table} t WHERE $1::text[] IS NOT NULL ${spec.where ? `AND ${spec.where}` : ""} ORDER BY ${spec.order}`;
  return (await db.query<{ row: Record<string, unknown> }>(sql, [excludeCodes, dropped])).rows.map(entry => entry.row);
}

// ---------------------------------------------------------------------------------------------------------------------------------
type Schema = Awaited<ReturnType<typeof isolatedSchema>>;
let source: Schema, target: Schema, inbound: Schema;
let sourceUrl = "", targetUrl = "", inboundUrl = "";
let stub: S3Stub;
let dir = "";
const srcBucket = `e2e-src-${randomBytes(4).toString("hex")}`;
const dstBucket = `e2e-dst-${randomBytes(4).toString("hex")}`;
const inbMediaBucket = `e2e-inb-${randomBytes(4).toString("hex")}`;
const inboundBucket = `e2e-inbound-${randomBytes(4).toString("hex")}`;

type Side = "source" | "target" | "inbound";
function sideOf(side: Side) {
  if (side === "source") return { schema: source, url: sourceUrl, bucket: undefined };
  if (side === "target") return { schema: target, url: targetUrl, bucket: dstBucket };
  return { schema: inbound, url: inboundUrl, bucket: inbMediaBucket };
}

/** Runs a bundle script as a child process against one schema and the stub; every spawn is checked first so it can reach nothing else. */
async function run(script: string, args: string[], side: Side, options: { env?: Record<string, string>; timeoutMs?: number } = {}) {
  const { schema, url, bucket } = sideOf(side);
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith("AWS_") || name.startsWith("S3_")) delete env[name];
  Object.assign(env, { DATABASE_URL: url, ...stubEnv(stub.url) });
  if (bucket) env.S3_BUCKET = bucket;
  // Names the child's database sessions after the schema; killChildSessions() ends what a timed-out child's own children left behind.
  env.PGAPPNAME = schema.name;
  Object.assign(env, options.env);
  assert.match(env.S3_ENDPOINT!, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(new URL(env.DATABASE_URL!).searchParams.get("options"), `-c search_path=${schema.name},public`);
  assert.ok(!args.some(arg => arg.startsWith("--env-file") || arg === "--prune"));
  try {
    return (await execFileAsync(process.execPath, ["--conditions=react-server", "--import", "tsx", `scripts/${script}`, ...args], { cwd: repoRoot, env, encoding: "utf8", maxBuffer: 1 << 26, timeout: options.timeoutMs ?? 60_000, killSignal: "SIGKILL" })).stdout;
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
  staticMedia: { digest: string; images: number; logos: number; sent: boolean }; images: unknown[]; logos: unknown[];
};
type PartManifest = {
  jobs: unknown[]; enrichments: unknown[]; vehicleData?: unknown; enrichmentsFile?: unknown; staticMedia?: unknown;
  images: unknown[]; logos: unknown[]; media: { id: string; sha256: string }[];
};

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
  // A payload the importers' enrichmentDataSchema accepts (the fitment rebuild parses it); only E2E-A carries a vehicle, type 101 (on every target).
  const vehicles = (code: Code): z.input<typeof enrichmentDataSchema>["vehicles"] => code === "E2E-A"
    ? [{ model: "FOCUS", engineAndCodes: "1.6", fuel: "Petrol", kw: 77, ps: 105, cc: 1596, from: "01/2004", to: "12/2010", typeId: 101 }] : [];
  const enrichment = (code: Code, image: string | null, basis: object, n: number) => pool.query(
    `INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,image_id,payload,imported_at,match_basis)
     VALUES($1,$2,$3,$4,'trodo',$5,$6,$7,$8,$9,$10)`,
    [sourceId[code], `SC-${code}`, `BRAND-${n}`, `https://example.com/p/${code}`, `MAN-${n}`, `PN-${n}`, image, { displayName: code, specifications: [["n", String(n)]], oemNumbers: {}, crossReferences: {}, vehicles: vehicles(code) } satisfies z.input<typeof enrichmentDataSchema>, day(n), JSON.stringify(basis)]);
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
async function tableRows(pool: Queryable, excludeCodes: string[], afterUpdate = false) {
  const rows = {} as Record<CarriedTable, Record<string, unknown>[]>;
  for (const table of TABLES) rows[table] = await compareRows(table, pool, excludeCodes, afterUpdate);
  return rows;
}

/** Every row of every base table of the pool's schema, as JSON in a stable order, ids included (nothing in an isolated schema changes on its own). */
async function rawSnapshot(pool: Queryable) {
  const snapshot: Record<string, unknown> = {};
  const tables = (await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name")).rows;
  assert.ok(tables.length > 20, "the schema snapshot found too few tables");
  for (const { table_name: table } of tables) {
    snapshot[table] = (await pool.query<{ rows: unknown }>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${table}" t`)).rows[0].rows;
  }
  return snapshot;
}

/** Ends the database sessions of a schema's child processes (named by PGAPPNAME in run()): a killed child's own children outlive it and would fall back to public. */
async function killChildSessions(schema: Schema | undefined) {
  if (schema) await schema.pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid()", [schema.name]);
}

/** Uploads a local directory to the stub under bucket/keyPrefix, keys with forward slashes. */
async function uploadDirToStub(localDir: string, bucket: string, keyPrefix: string) {
  for (const entry of await readdir(localDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    stub.objects.set(`${bucket}/${keyPrefix}/${relative(localDir, file).split(sep).join("/")}`, { bytes: await readFile(file), contentType: "application/octet-stream" });
  }
}
/** Uploads split parts as <prefix>/<part dir name>/ into the inbound bucket. */
async function uploadParts(parts: string[], prefix: string) {
  for (const part of parts) await uploadDirToStub(part, inboundBucket, `${prefix}/${basename(part)}`);
}

async function compareAll(excludeCodes: string[] = [], afterUpdate = false, extraDropped: ExtraDropped = {}) {
  for (const table of TABLES) {
    const [fromSource, fromTarget] = [await compareRows(table, source.pool, excludeCodes, afterUpdate, extraDropped), await compareRows(table, target.pool, excludeCodes, afterUpdate, extraDropped)];
    assert.ok(fromSource.length > 0 && fromTarget.length > 0, `${table}: the comparison is empty (source ${fromSource.length}, target ${fromTarget.length} rows)`);
    assert.deepEqual(fromTarget, fromSource, `${table} differs between source and target`);
  }
}

// A column default that changes with time or a sequence says nothing about whether the column was carried.
const VOLATILE_DEFAULT = /\b(now|clock_timestamp|statement_timestamp|transaction_timestamp|gen_random_uuid|nextval|random)\s*\(|\bcurrent_/i;

/** Every column of a carried table is either listed in LOCAL_ONLY or has a value in the fixture on both sides, and a column with a constant default a value other than it. */
async function assertColumnCoverage() {
  for (const table of TABLES) {
    const columns = (await source.pool.query<{ column_name: string; column_default: string | null }>(
      "SELECT column_name,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
      [source.name, table])).rows;
    assert.ok(columns.length > 0, `${table} has no columns in the source schema`);
    for (const { column_name: column, column_default: fallback } of columns.filter(entry => !(entry.column_name in LOCAL_ONLY[table]))) {
      const constant = fallback !== null && !VOLATILE_DEFAULT.test(fallback);
      for (const [side, pool] of [["source", source.pool], ["target", target.pool]] as const) {
        // The default is a catalog expression (constants only here, checked above), so it is evaluated by the database, never built from input.
        const { rows } = await pool.query<{ filled: number; custom: number }>(
          `SELECT count("${column}")::int AS filled, ${constant ? `count(*) FILTER (WHERE "${column}" IS DISTINCT FROM (${fallback}))` : "0"}::int AS custom FROM ${table}`);
        assert.ok(rows[0].filled > 0, `${table}.${column} is empty on the ${side}: seed ${table}.${column} in the fixture and carry it, or add it to LOCAL_ONLY with a reason`);
        assert.ok(!constant || rows[0].custom > 0, `${table}.${column} only holds its default (${fallback}) on the ${side}: seed a non-default ${table}.${column} in the fixture and carry it, or add it to LOCAL_ONLY with a reason`);
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
  inbound = await isolatedSchema("storefront_e2e_inb");
  inboundUrl = process.env.DATABASE_URL!;
  await seedSource(source.pool);
  await seedTarget(target.pool);
  await seedTarget(inbound.pool);
});
// The schemas restore DATABASE_URL in nested order, so they are dropped innermost first.
after(async () => {
  try { await killChildSessions(inbound); await inbound?.drop(); } finally {
    try { await killChildSessions(target); await target?.drop(); } finally {
      try { await killChildSessions(source); await source?.drop(); } finally {
        try { await stub?.close(); } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
      }
    }
  }
});

const state: {
  digest: string; staticDigest: string; snapshotAt: string; skipped: unknown[]; vehicleSnapshot: unknown[];
  full1: string; parts1: string[]; parts2: string[]; run1Reports: PartReport[]; run1Target: Record<CarriedTable, Record<string, unknown>[]> | null; run1SharedQueue: number;
  parts4: string[]; snapshot4: string;
} = { digest: "", staticDigest: "", snapshotAt: "", skipped: [], vehicleSnapshot: [], full1: "", parts1: [], parts2: [], run1Reports: [], run1Target: null, run1SharedQueue: 0,
  parts4: [], snapshot4: "" };
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
  state.full1 = full;
  state.parts1 = parts;
  state.run1Reports = reports;
  state.run1Target = await tableRows(target.pool, ["E2E-MISSING"]);
  state.run1SharedQueue = (await target.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM product_enrichment_shared_queue")).rows[0].n;
  assert.ok(state.run1SharedQueue > 0, "the per-part import queued nothing for the derived tables");
  // Without a drain the per-part import leaves the state queue filled too, so "drained" after the inbound run cannot pass vacuously.
  assert.ok((await target.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM enrichment_product_state_queue")).rows[0].n > 0, "the per-part import queued no product states");
  assert.equal((await target.pool.query("SELECT 1 FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id WHERE s.code='E2E-PENDING'")).rowCount, 0);
  const exported = await readLines<{ bucket: string; object_key: string; sha256: string }>(join(full, "media.ndjson"));
  assert.equal(exported.length, 5);
  for (const object of exported) {
    const stored = stub.objects.get(`${dstBucket}/${object.object_key}`);
    assert.ok(stored, `${object.object_key} is not in the target bucket`);
    assert.deepEqual(stored.bytes, stub.objects.get(`${srcBucket}/${object.object_key}`)!.bytes);
    // What lets the next import skip it with one HEAD (#1406).
    assert.deepEqual(stored.metadata, { sha256: object.sha256 }, `${object.object_key} has no sha256 metadata`);
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
  // The update path: every carried non-key column of one row that is already on the target changes, in each table the delta carries.
  // Timestamps travel as JSON through a JS Date: milliseconds, so the edits are set at that precision. Tables whose only columns are
  // keys (product_source_categories) change by replacing a row; vehicle data changes in run 3, which is where it travels.
  const a = sourceId["E2E-A"];
  await source.pool.query(`UPDATE product_enrichments SET supplier_code='SC-A2',supplier_brand='BRAND-A2',source_url='https://example.com/p/A2',source_method='otoparcasan',
    manufacturer='MAN-A2',manufacturer_part_number='PN-A2',image_id=$2,payload='{"specifications":[["changed","1"]],"oemNumbers":{},"crossReferences":{},"vehicles":[]}',imported_at=date_trunc('milliseconds',now()),match_basis='{"type":"cross","oem":"999"}'
    WHERE supplier_item_id=$1`, [a, mediaId.mGone]);
  await source.pool.query(`UPDATE product_enrichment_jobs SET status='partial',supplier_code='SC-A2',supplier_brand='BRAND-A2',oem='OEM-A2',candidate_url='https://example.com/cand/A2',
    last_attempt_at=$2 WHERE supplier_item_id=$1`, [a, day(28)]);
  // A job whose only change is its OEM is rewritten too: the target counts a failed job only while its OEM matches (#1386).
  await source.pool.query("UPDATE product_enrichment_jobs SET oem='OEM-B2' WHERE supplier_item_id=$1", [sourceId["E2E-B"]]);
  await source.pool.query("DELETE FROM product_source_categories WHERE supplier_item_id=$1 AND category_id=2", [a]);
  await source.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'otoparcasan',9)", [a]);
  await source.pool.query(`UPDATE source_categories SET parent_id=NULL,name='Filtre 2',slug='filtre-2',path_ids='{2}',source_url='https://example.com/c2b',raw='{"id":2,"changed":true}',fetched_at=$1
    WHERE source='trodo' AND category_id=2`, [day(29)]);
  await source.pool.query("UPDATE source_category_labels SET name='Filtre 2',slug='filtre-2' WHERE source='trodo' AND category_id=2 AND locale='tr'");
  await source.pool.query("UPDATE source_category_images SET media_id=$1,width=321,height=241 WHERE source='trodo' AND category_id=2", [mediaId.mA]);
  const logo = randomBytes(40);
  await source.pool.query(`UPDATE manufacturer_logos SET manufacturer='FEBI AG',image_data=$1,sha256=$2,width=99,height=33,source_url='https://example.com/logo/FEBI2',
    evidence_product_id=$3,evidence_source_url='https://example.com/evidence/FEBI2',imported_at=$4 WHERE brand_key='FEBI'`, [logo, sha256(logo), sourceId["E2E-B"], day(30)]);
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
  // Run 2 changed a category image and a logo, so its static media goes (no --static-digest); run 3 confirms its digest.
  assert.equal(manifest.staticMedia.sent, true);
  state.staticDigest = manifest.staticMedia.digest;
  assert.deepEqual([manifest.vehicleSpecs, manifest.vehicleImages], [[], []]);
  assert.equal(manifest.enrichmentCount, 2);
  assert.deepEqual(manifest.tombstones.map(row => [row.code, row.kind]), [["E2E-GONE", "enrichment_deleted"]]);
  assert.ok(!(await readLines<{ id: string }>(join(full, "media.ndjson"))).some(row => row.id === mediaId.mVeh));

  const parts = await splitStorefrontBundle(full, join(dir, "parts2"), { mediaBytes: 1e9, jsonBytes: 1e9 });
  assert.equal(parts.length, 3);
  state.parts2 = parts;
  const { totals } = buildInboundReport(await importParts(parts));
  assert.deepEqual([totals.removedEnrichments, totals.resetJobs, totals.enrichments, totals.skippedEnrichments], [1, 1, 2, 0]);
  assert.ok(!stub.puts.some(path => path.endsWith(mediaKey("mVeh"))), "the unchanged vehicle image was uploaded again");
  assert.deepEqual(await vehicleRows(target.pool), state.vehicleSnapshot);

  await compareAll([], true);
  const gone = (await target.pool.query<{ status: string; last_error: string | null }>(
    "SELECT j.status,j.last_error FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id WHERE s.code='E2E-GONE'")).rows;
  assert.deepEqual(gone, [{ status: "pending", last_error: REMOVED_JOB_ERROR }]);
});

test("run 3: changed vehicle data is sent again whatever digest the target confirmed, and updates the rows already there", { skip }, async () => {
  // Every carried non-key column of an imported spec (101) and image (101) changes; 102 changes its outcome, which 101 keeps.
  await source.pool.query(`UPDATE vehicle_type_specs SET detail='changed detail',full_name='changed',body_type='Sedan',drive_type='AWD',engine_type='Hybrid',fuel_mixture='Carburettor',
    cylinders=6,valves=24,engine_codes='{Z1}',kba_numbers='{9999}',fetched_at=$1 WHERE vehicle_type_id=101`, [day(27)]);
  await source.pool.query("UPDATE vehicle_type_specs SET outcome='found',full_name='Ford Focus 2' WHERE vehicle_type_id=102");
  await source.pool.query("UPDATE vehicle_type_images SET media_id=$1,width=641,height=321,imported_at=$2 WHERE vehicle_type_id=101", [mediaId.mGone, day(27)]);
  const full = join(dir, "full3");
  await run("export-storefront-bundle.ts", [full, `--vehicle-digest=${state.digest}`, `--static-digest=${state.staticDigest}`], "source");
  const manifest = await readJson<ExportManifest>(join(full, "manifest.json"));
  assert.equal(manifest.vehicleData.sent, true);
  assert.notEqual(manifest.vehicleData.digest, state.digest);
  assert.equal(manifest.vehicleSpecs.length, 3);
  // The category images and logos run 2 sent are unchanged: skipped (#1379). Run 2 pointed a category image at an enrichment's media.
  assert.equal(manifest.staticMedia.sent, false);
  assert.equal(manifest.staticMedia.digest, state.staticDigest);
  assert.deepEqual([manifest.staticMedia.images, manifest.staticMedia.logos], [1, 2]);
  assert.deepEqual([manifest.images, manifest.logos], [[], []]);

  const parts = await splitStorefrontBundle(full, join(dir, "parts3"), { mediaBytes: 1e9, jsonBytes: 1e9 });
  const partManifests = await Promise.all(parts.map(part => readJson<PartManifest>(join(part, "manifest.json"))));
  assert.ok(partManifests.every(part => part.images.length === 0 && part.logos.length === 0 && !("staticMedia" in part)));
  // part-00 carries only the media of what it sends: the vehicle image, none of the category image's.
  assert.deepEqual(partManifests[0].media.map(object => object.id), [mediaId.mGone]);
  const reports = await importParts(parts);
  const { totals } = buildInboundReport(reports);
  assert.deepEqual([totals.vehicleSpecs, totals.vehicleImages, totals.skippedVehicleSpecs], [2, 1, 1]);
  assert.deepEqual([totals.categoryImages, totals.logos], [0, 0]);
  await compareAll([], true);
});

test("run 3: the static media digest flips when one logo changes, and the logos and category images travel again", { skip }, async () => {
  // Not imported here; run 4's full export carries the changed logo and category image to the target.
  const bytes = randomBytes(24);
  await source.pool.query("UPDATE source_category_images SET media_id=$1 WHERE source='trodo' AND category_id=2", [mediaId.mCat]);
  await source.pool.query("UPDATE manufacturer_logos SET image_data=$1,sha256=$2 WHERE brand_key='MANN'", [bytes, sha256(bytes)]);
  const full = join(dir, "full3-logo");
  await run("export-storefront-bundle.ts", [full, `--vehicle-digest=${state.digest}`, `--static-digest=${state.staticDigest}`], "source");
  const manifest = await readJson<ExportManifest>(join(full, "manifest.json"));
  assert.equal(manifest.staticMedia.sent, true);
  assert.notEqual(manifest.staticMedia.digest, state.staticDigest);
  assert.equal(manifest.logos.length, 2);
  assert.equal(manifest.images.length, 1);
  // mCat is referenced by nothing an enrichment or the vehicle data carries, so its media row travels only with the category images.
  assert.deepEqual((manifest.images as { media_id: string }[]).map(row => row.media_id), [mediaId.mCat]);
  assert.ok((await readLines<{ id: string }>(join(full, "media.ndjson"))).some(row => row.id === mediaId.mCat));
});

test("run 4: media the target already holds under another id and object key is reused by every table that references it (#1385)", { skip }, async () => {
  // One object per referencing table. The target holds each under an id and an object key the bundle does not know; the importer
  // resolves bundle media by sha256 (ON CONFLICT DO NOTHING on the unique sha256, then bundle_media), so nothing may point at a new row.
  const names = ["enrichment", "category", "vehicle"] as const;
  const objects = names.map(name => {
    const bytes = randomBytes(64), sha = sha256(bytes), sourceUrl = `https://example.com/dup-${name}.png`;
    return { name, bytes, sha, sourceUrl, sourceId: randomUUID(), bundleKey: `e2e/${sha}.png`, existingId: randomUUID(), existingKey: `legacy/${randomUUID()}.png` };
  });
  const insertMedia = (pool: Pool, id: string, bucket: string, key: string, object: (typeof objects)[number]) => pool.query(
    `INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url,created_at,stored_at) VALUES($1,$2,$3,$4,'image/png',64,$5,$6,$7)`,
    [id, bucket, key, object.sha, object.sourceUrl, day(2), day(3)]);
  for (const object of objects) {
    await insertMedia(source.pool, object.sourceId, srcBucket, object.bundleKey, object);
    stub.objects.set(`${srcBucket}/${object.bundleKey}`, { bytes: object.bytes, contentType: "image/png" });
    await insertMedia(target.pool, object.existingId, dstBucket, object.existingKey, object);
    stub.objects.set(`${dstBucket}/${object.existingKey}`, { bytes: randomBytes(64), contentType: "image/png" });
  }
  const [forEnrichment, forCategory, forVehicle] = objects;
  await source.pool.query("UPDATE product_enrichments SET image_id=$2,imported_at=date_trunc('milliseconds',now()) WHERE supplier_item_id=$1", [sourceId["E2E-B"], forEnrichment.sourceId]);
  await source.pool.query("UPDATE source_category_images SET media_id=$1 WHERE source='trodo' AND category_id=2", [forCategory.sourceId]);
  await source.pool.query("UPDATE vehicle_type_images SET media_id=$1 WHERE vehicle_type_id=101", [forVehicle.sourceId]);

  // No digests: the category images, logos and vehicle data go whole.
  const full = join(dir, "full4");
  await run("export-storefront-bundle.ts", [full], "source");
  state.snapshot4 = (await readJson<ExportManifest>(join(full, "manifest.json"))).snapshotAt;
  const parts = await splitStorefrontBundle(full, join(dir, "parts4"), { mediaBytes: 1e9, jsonBytes: 1e9 });
  const bundled = new Set((await readLines<{ id: string }>(join(full, "media.ndjson"))).map(row => row.id));
  for (const object of objects) assert.ok(bundled.has(object.sourceId), `${object.name}: the bundle does not carry the object`);
  stub.puts.length = 0;
  const { totals } = buildInboundReport(await importParts(parts));
  assert.ok(totals.categoryImages > 0 && totals.vehicleImages > 0 && totals.enrichments > 0);

  const one = async <T>(sql: string, ...params: unknown[]) => {
    const { rows } = await target.pool.query<{ v: T }>(sql, params);
    assert.equal(rows.length, 1);
    return rows[0].v;
  };
  assert.equal(await one<string>("SELECT e.image_id AS v FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id WHERE s.code='E2E-B'"), forEnrichment.existingId);
  assert.equal(await one<string>("SELECT media_id AS v FROM source_category_images WHERE source='trodo' AND category_id=2"), forCategory.existingId);
  assert.equal(await one<string>("SELECT media_id AS v FROM vehicle_type_images WHERE vehicle_type_id=101"), forVehicle.existingId);
  for (const object of objects) {
    // One row per sha256, still the old one: not replaced, not duplicated, not renamed to the bundle's key.
    const rows = (await target.pool.query<{ id: string; bucket: string; object_key: string }>("SELECT id,bucket,object_key FROM product_media_objects WHERE sha256=$1", [object.sha])).rows;
    assert.deepEqual(rows, [{ id: object.existingId, bucket: dstBucket, object_key: object.existingKey }], `${object.name}: the target's media rows`);
    assert.equal((await target.pool.query("SELECT 1 FROM product_media_objects WHERE object_key=$1", [object.bundleKey])).rowCount, 0);
    // The bundle's own key is never written or created; the existing object holds the bundle's bytes (its stub bytes were different before).
    assert.ok(!stub.puts.some(path => path.endsWith(object.bundleKey) && path.startsWith(`${dstBucket}/`)), `${object.name}: the bundle's object key was uploaded`);
    assert.ok(!stub.objects.has(`${dstBucket}/${object.bundleKey}`));
    // The existing object held other bytes and no sha256 metadata, so it is healed and stamped (#1406); a verified one is not
    // written (run 5).
    assert.ok(stub.puts.includes(`${dstBucket}/${object.existingKey}`), `${object.name}: the existing object was not written`);
    assert.deepEqual(stub.objects.get(`${dstBucket}/${object.existingKey}`)!.bytes, object.bytes);
    assert.deepEqual(stub.objects.get(`${dstBucket}/${object.existingKey}`)!.metadata, { sha256: object.sha }, `${object.name}: the existing object was not stamped`);
  }
  // Every other object of these parts was stored (with its metadata) by an earlier run: only the three healed ones are written.
  assert.deepEqual([...stub.puts].sort(), objects.map(object => `${dstBucket}/${object.existingKey}`).sort());
  // Rows compare by sha256; only the object key of the three remapped objects differs, and it differs by design.
  await compareAll([], true, { product_media_objects: ["object_key"] });
  const keyBySha = async (pool: Pool) => Object.fromEntries((await pool.query<{ sha256: string; object_key: string }>("SELECT sha256,object_key FROM product_media_objects")).rows.map(row => [row.sha256, row.object_key]));
  const [fromSource, fromTarget] = [await keyBySha(source.pool), await keyBySha(target.pool)];
  for (const object of objects) { assert.equal(fromSource[object.sha], object.bundleKey); assert.equal(fromTarget[object.sha], object.existingKey); }
  const rest = (keys: Record<string, string>) => Object.fromEntries(Object.entries(keys).filter(([sha]) => !objects.some(object => object.sha === sha)));
  assert.deepEqual(rest(fromTarget), rest(fromSource));
  state.parts4 = parts;
});

/** The object paths (bucket/key) the target's media rows give the media of `parts`, and how many media rows the parts carry in all. */
async function partMedia(parts: string[]) {
  const manifests = await Promise.all(parts.map(part => readJson<PartManifest>(join(part, "manifest.json"))));
  const shas = [...new Set(manifests.flatMap(part => part.media.map(object => object.sha256)))];
  const rows = (await target.pool.query<{ path: string }>("SELECT bucket||'/'||object_key AS path FROM product_media_objects WHERE sha256=ANY($1) ORDER BY sha256", [shas])).rows;
  assert.equal(rows.length, shas.length, "a part's media has no row on the target");
  return { paths: rows.map(row => row.path), rows: manifests.reduce((sum, part) => sum + part.media.length, 0) };
}
const resetRequests = () => { for (const list of [stub.puts, stub.gets, stub.heads]) list.length = 0; };

test("run 5: a second import of the same parts sends no PUT and no object GET (#1406)", { skip }, async () => {
  assert.ok(state.parts4.length > 1, "run 4 must have produced parts");
  const media = await partMedia(state.parts4);
  assert.ok(media.rows > 3);
  resetRequests();
  const { totals } = buildInboundReport(await importParts(state.parts4));
  assert.deepEqual(stub.puts, []);
  assert.deepEqual(stub.gets, []);
  // One HEAD per media row of each part, nothing more.
  assert.equal(stub.heads.length, media.rows);
  assert.ok(stub.heads.every(path => path.startsWith(`${dstBucket}/`)));
  assert.deepEqual([totals.media, totals.mediaUploaded, totals.mediaVerified], [media.rows, 0, media.rows]);
  await compareAll([], true, { product_media_objects: ["object_key"] });
});

test("run 5: a missing, a truncated and a metadata-less object are rewritten, nothing else (#1406)", { skip }, async () => {
  const [missing, truncated, unstamped] = (await partMedia(state.parts4)).paths;
  const original = new Map([missing, truncated, unstamped].map(path => [path, stub.objects.get(path)!]));
  assert.ok([...original.values()].every(object => object?.metadata?.sha256), "the objects to break are not stored and stamped");
  stub.objects.delete(missing);
  stub.objects.set(truncated, { ...original.get(truncated)!, bytes: original.get(truncated)!.bytes.subarray(1) });
  stub.objects.set(unstamped, { bytes: original.get(unstamped)!.bytes, contentType: original.get(unstamped)!.contentType });
  resetRequests();
  const { totals } = buildInboundReport(await importParts(state.parts4));
  const broken = [missing, truncated, unstamped].sort();
  assert.deepEqual([...stub.puts].sort(), broken);
  assert.deepEqual([...stub.gets].sort(), broken);
  for (const path of broken) {
    assert.deepEqual(stub.objects.get(path)?.bytes, original.get(path)!.bytes, `${path} was not restored`);
    assert.deepEqual(stub.objects.get(path)?.metadata, original.get(path)!.metadata, `${path} was not stamped`);
  }
  assert.equal(totals.mediaUploaded, 3);
  await compareAll([], true, { product_media_objects: ["object_key"] });
});

test("run 6: a part whose media cannot be stored (its key holds other media, or the upload fails) writes no rows, and applies once it can (#1406)", { skip }, async () => {
  assert.ok(state.snapshot4, "run 4 must have exported");
  const bytes = randomBytes(64), sha = sha256(bytes), key = `e2e/${sha}.png`, id = randomUUID();
  await source.pool.query(`INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url,created_at,stored_at) VALUES($1,$2,$3,$4,'image/png',64,$5,$6,$7)`,
    [id, srcBucket, key, sha, "https://example.com/upload-fails.png", day(2), day(3)]);
  stub.objects.set(`${srcBucket}/${key}`, { bytes, contentType: "image/png" });
  await source.pool.query("UPDATE product_enrichments SET image_id=$2,imported_at=date_trunc('milliseconds',now()) WHERE supplier_item_id=$1", [sourceId["E2E-A"], id]);
  const full = join(dir, "full6");
  await run("export-storefront-bundle.ts", [full, `--since=${state.snapshot4}`], "source");
  const parts = await splitStorefrontBundle(full, join(dir, "parts6"), { mediaBytes: 1e9, jsonBytes: 1e9 });
  const manifests = await Promise.all(parts.map(part => readJson<PartManifest>(join(part, "manifest.json"))));
  const failing = manifests.findIndex(part => part.media.some(object => object.sha256 === sha));
  assert.ok(failing > 0, "the new media is not in an enrichment part");
  assert.equal(manifests[failing].enrichments.length, 1);

  await importParts(parts.slice(0, failing));
  // The new object's key already belongs to a target row with other content: the importer stops before touching any object,
  // where storing first would overwrite that row's object (the INSERT would then skip the bundle row on UNIQUE(bucket,object_key)).
  const path = `${dstBucket}/${key}`, otherBytes = randomBytes(64), otherSha = sha256(otherBytes), otherId = randomUUID();
  await target.pool.query(`INSERT INTO product_media_objects(id,bucket,object_key,sha256,content_type,size_bytes,source_url,created_at) VALUES($1,$2,$3,$4,'image/png',64,$5,$6)`,
    [otherId, dstBucket, key, otherSha, "https://example.com/key-taken.png", day(2)]);
  stub.objects.set(path, { bytes: otherBytes, contentType: "image/png", metadata: { sha256: otherSha } });
  const taken = await rawSnapshot(target.pool);
  resetRequests();
  await assert.rejects(importParts([parts[failing]]), (error: Error) => {
    assert.match(error.message, /already hold other media here, nothing was stored/);
    assert.ok(error.message.includes(path), "the error does not name the key");
    return true;
  });
  assert.deepEqual([stub.puts, stub.gets, stub.heads], [[], [], []], "an object was touched before the key conflict stopped the import");
  assert.deepEqual(stub.objects.get(path), { bytes: otherBytes, contentType: "image/png", metadata: { sha256: otherSha } });
  assert.deepEqual(await rawSnapshot(target.pool), taken);
  await target.pool.query("DELETE FROM product_media_objects WHERE id=$1", [otherId]);
  stub.objects.delete(path);

  const before = await rawSnapshot(target.pool);
  stub.failPuts.add(path);
  try {
    await assert.rejects(importParts([parts[failing]]), /AccessDenied|403/);
  } finally { stub.failPuts.clear(); }
  assert.deepEqual(await rawSnapshot(target.pool), before);
  assert.equal((await target.pool.query("SELECT 1 FROM product_media_objects WHERE sha256=$1", [sha])).rowCount, 0);
  assert.ok(!stub.objects.has(`${dstBucket}/${key}`));

  await importParts(parts.slice(failing));
  assert.deepEqual(stub.objects.get(`${dstBucket}/${key}`)?.bytes, bytes);
  assert.equal(await target.pool.query<{ sha: string }>(`SELECT m.sha256 AS sha FROM product_enrichments e JOIN supplier_items s ON s.id=e.supplier_item_id
    JOIN product_media_objects m ON m.id=e.image_id WHERE s.code='E2E-A'`).then(result => result.rows[0]?.sha), sha);
  await compareAll([], true, { product_media_objects: ["object_key"] });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The golden fixture (#1383): scripts/fixtures/storefront-part-format.json is generated from the hand-written sample rows of
// test-storefront-split.ts, so on its own it cannot tell when the exporter starts writing another column. Here every row type the
// fixture describes is compared with the rows the real exporter wrote and the real split cut (runs 1 and 2: run 2 is the one with a tombstone).
type GoldenNode = string | { [key: string]: unknown };
const GOLDEN_FILE = "scripts/fixtures/storefront-part-format.json";
const GOLDEN_UPDATE = "update the sample rows of the 'storefront part format' test in scripts/test-storefront-split.ts to match (release the importer first if it must read a new column), then regenerate the fixture with `UPDATE_GOLDEN=1 node --import tsx --test scripts/test-storefront-split.ts` (local only)";
const jsonType = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
/** The JSON types a fixture node allows for one value: "string", an array node ({ "[]": ... }), an object node, or a oneOf of those. */
function nodeTypes(node: unknown): Set<string> {
  if (typeof node === "string") return new Set([node]);
  const alternatives = (node as { oneOf?: unknown[] }).oneOf;
  if (alternatives) return new Set(alternatives.flatMap(alternative => [...nodeTypes(alternative)]));
  return new Set(["[]" in (node as object) ? "array" : "object"]);
}
/** A fixture node that describes rows: an array whose element is an object of columns (not "empty", a scalar, or a oneOf). */
function rowNode(node: unknown): Record<string, unknown> | null {
  const element = node && typeof node === "object" ? (node as { "[]"?: unknown })["[]"] : undefined;
  return element && typeof element === "object" && !("oneOf" in element) && !("[]" in element) ? element as Record<string, unknown> : null;
}
/** Why the JSON types seen in the real export and the ones the fixture allows disagree (null when they do not). A fixture type that is only null says nothing, so it
 * fails as soon as the real export holds a value. A real null is allowed against a typed fixture for a top-level key; for a row column (`strict`) the fixture must allow it too. */
function typeProblem(real: Set<string>, fixed: Set<string>, strict: boolean) {
  const realValued = [...real].filter(type => type !== "null").sort(), fixedValued = [...fixed].filter(type => type !== "null").sort();
  const mismatch = realValued.length === 0 ? !fixed.has("null") : realValued.join() !== fixedValued.join() || (strict && real.has("null") && !fixed.has("null"));
  return mismatch ? `the real export holds ${[...real].sort().join("|")}, the fixture ${[...fixed].sort().join("|")}` : null;
}
/** The type problem of one key, and of the elements of an array of scalars (path_ids, engine_codes, kba_numbers). Values below an object column (jsonb: raw, payload, match_basis) are deliberately not compared: they are free-form. */
function valueProblem(values: unknown[], node: unknown, strict: boolean) {
  const problem = typeProblem(new Set(values.map(jsonType)), nodeTypes(node), strict);
  if (problem) return problem;
  const element = (node as { "[]"?: unknown })["[]"];
  if (element === undefined || (element !== null && typeof element === "object" && !("oneOf" in element))) return null;
  const elements = values.filter(Array.isArray).flat();
  const inner = elements.length ? typeProblem(new Set(elements.map(jsonType)), nodeTypes(element), strict) : null;
  return inner && `its elements: ${inner}`;
}
/** Differences between a fixture row type and the real rows of it, as readable lines (none when the shapes agree). Values below a column (jsonb) are not compared, scalar arrays only by element type. */
function rowShapeProblems(label: string, fixture: Record<string, unknown>, rows: Record<string, unknown>[]) {
  const problems: string[] = [];
  if (rows.length === 0) return [`${label}: the real export has no such rows, so the fixture's row type is not checked`];
  const expected = Object.keys(fixture).sort();
  const extra = new Set<string>(), missing = new Set<string>();
  for (const row of rows) {
    const keys = Object.keys(row);
    for (const key of keys) if (!expected.includes(key)) extra.add(key);
    for (const key of expected) if (!keys.includes(key)) missing.add(key);
  }
  if (extra.size) problems.push(`${label}: the real rows have keys the fixture lacks: ${[...extra].sort().join(", ")}`);
  if (missing.size) problems.push(`${label}: the fixture has keys the real rows lack: ${[...missing].sort().join(", ")}`);
  for (const key of expected.filter(name => !missing.has(name))) {
    const problem = valueProblem(rows.map(row => row[key]), fixture[key], true);
    if (problem) problems.push(`${label}.${key}: ${problem}`);
  }
  return problems;
}

test("the golden fixture's row shapes are the ones the real export writes (#1383)", { skip }, async () => {
  assert.ok(state.parts1.length > 1 && state.parts2.length > 1, "runs 1 and 2 must have produced parts");
  const golden = await readJson<Record<string, Record<string, GoldenNode>>>(join(repoRoot, GOLDEN_FILE));
  const manifests = async (parts: string[]) => Promise.all(parts.map(part => readJson<Record<string, unknown>>(join(part, "manifest.json"))));
  const [first, second] = [await manifests(state.parts1), await manifests(state.parts2)];
  const carrying = (name: string) => [...first, ...second].filter(part => (part[name] as unknown[]).length > 0);
  const partsOf = (kind: string) => kind === "part-00" ? [first[0], second[0]] : carrying(kind === "job parts" ? "jobs" : "enrichments");
  const problems: string[] = [];
  for (const [kind, schema] of Object.entries(golden)) {
    const parts = partsOf(kind);
    assert.ok(parts.length > 0, `${kind}: the real export has no such part`);
    const keys = new Set(parts.flatMap(part => Object.keys(part)));
    const fixed = Object.keys(schema);
    const [extra, missing] = [[...keys].filter(key => !fixed.includes(key)), fixed.filter(key => !keys.has(key))];
    if (extra.length) problems.push(`${kind}: the real manifest has keys the fixture lacks: ${extra.sort().join(", ")}`);
    if (missing.length) problems.push(`${kind}: the fixture has keys the real manifest lacks: ${missing.sort().join(", ")}`);
    for (const [name, node] of Object.entries(schema)) {
      const values = parts.map(part => part[name]).filter(value => value !== undefined);
      const row = rowNode(node);
      if (row) problems.push(...rowShapeProblems(`${kind}.${name}`, row, values.flat() as Record<string, unknown>[]));
      else if (node === "empty" || (node as { "[]"?: unknown })["[]"] === "empty") {
        if (values.some(value => (value as unknown[]).length > 0)) problems.push(`${kind}.${name}: the fixture has no rows here but the real parts carry some`);
      } else {
        const problem = valueProblem(values, node, false);
        if (problem) problems.push(`${kind}.${name}: ${problem}`);
      }
    }
  }
  assert.deepEqual(problems, [], `${GOLDEN_FILE} drifted from the real export:\n${problems.join("\n")}\nTo fix it, ${GOLDEN_UPDATE}.`);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// import-storefront-inbound.ts (#1384): the operations-task entry point, on its own schema and bucket pair.
const inboundRun = (prefix: string) => run("import-storefront-inbound.ts", [prefix], "inbound", { env: { INBOUND_BUCKET: inboundBucket }, timeoutMs: 180_000 });
const countOf = (text: string, needle: string) => text.split(needle).length - 1;

test("inbound: a part that fails its dry run stops the run before anything is applied", { skip }, async () => {
  assert.ok(state.parts1.length > 1);
  await uploadParts(state.parts1, "storefront/broken");
  // The last part gets a category image row the importer cannot match: its dry run throws, after the other parts' dry runs passed.
  const brokenKey = `${inboundBucket}/storefront/broken/${basename(state.parts1[state.parts1.length - 1])}/manifest.json`;
  const original = stub.objects.get(brokenKey)!;
  const manifest = JSON.parse(original.bytes.toString("utf8")) as { images?: unknown[] };
  manifest.images = [...(manifest.images ?? []), { source: "trodo", category_id: 2, media_id: randomUUID(), width: 1, height: 1 }];
  stub.objects.set(brokenKey, { bytes: Buffer.from(JSON.stringify(manifest)), contentType: original.contentType });

  const before = await rawSnapshot(inbound.pool);
  const puts = stub.puts.length;
  await assert.rejects(inboundRun("storefront/broken"), (error: Error) => {
    assert.match(error.message, /Category image rows mismatch/);
    assert.match(error.message, /import-storefront-bundle\.ts .* failed with exit code 1/);
    assert.doesNotMatch(error.message, /APPLIED/);
    assert.equal(countOf(error.message, "DRY RUN (nothing written)"), state.parts1.length - 1);
    return true;
  });
  assert.deepEqual(await rawSnapshot(inbound.pool), before);
  assert.equal((await inbound.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM product_enrichments")).rows[0].n, 0);
  assert.ok(![...stub.objects.keys()].some(key => key.startsWith(`${inbMediaBucket}/`)), "the failed run wrote to the media bucket");
  assert.equal(stub.puts.length, puts);
  // Dry runs send nothing to the media bucket, not even a HEAD (#1406).
  assert.ok(!stub.heads.some(path => path.startsWith(`${inbMediaBucket}/`)), "a dry run checked media objects");
});

test("inbound: the e2e parts imported by import-storefront-inbound.ts leave the same target and report as the per-part import", { skip }, async () => {
  assert.ok(state.run1Target);
  await uploadParts(state.parts1, "storefront/current");
  const out = await inboundRun("storefront/current");

  const count = state.parts1.length;
  assert.equal(countOf(out, "DRY RUN (nothing written)"), count);
  assert.equal(countOf(out, "APPLIED"), count);
  assert.ok(out.lastIndexOf("DRY RUN (nothing written)") < out.indexOf("APPLIED"), "a dry run came after the first apply");

  const imported = await tableRows(inbound.pool, ["E2E-MISSING"]);
  for (const table of TABLES) {
    assert.ok(imported[table].length > 0, `${table} is empty after the inbound import`);
    assert.deepEqual(imported[table], state.run1Target[table], `${table} differs from the per-part import`);
  }
  for (const object of await readLines<{ object_key: string }>(join(state.full1, "media.ndjson"))) {
    const stored = stub.objects.get(`${inbMediaBucket}/${object.object_key}`);
    assert.ok(stored, `${object.object_key} is not in the media bucket`);
    assert.deepEqual(stored.bytes, stub.objects.get(`${srcBucket}/${object.object_key}`)!.bytes);
  }

  assert.ok(!stub.puts.some(path => path.startsWith(`${inboundBucket}/`)), "the task wrote to the inbound parts bucket");
  const written = stub.objects.get(`${inbMediaBucket}/${reportKey("storefront/current")}`);
  assert.ok(written, "report.json was not written");
  assert.equal(written.contentType, "application/json");
  const report = JSON.parse(written.bytes.toString("utf8")) as Parameters<typeof checkInboundReport>[0] & object;
  assert.deepEqual(report, JSON.parse(JSON.stringify({ snapshotAt: state.snapshotAt, ...buildInboundReport(state.run1Reports) })));
  assert.ok(!("items" in report));
  checkInboundReport(report, state.snapshotAt);

  const fitments = (await inbound.pool.query("SELECT s.code,f.vehicle_type_id,f.match_status FROM product_vehicle_fitments f JOIN supplier_items s ON s.id=f.supplier_item_id")).rows;
  assert.deepEqual(fitments, [{ code: "E2E-A", vehicle_type_id: 101, match_status: "matched" }]);
  assert.match(out, /"mode":"scoped","requested":4/);
  for (const queue of ["product_enrichment_shared_queue", "enrichment_product_state_queue"]) {
    assert.equal((await inbound.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${queue}`)).rows[0].n, 0, `${queue} is not drained`);
  }
  assert.match(out, /"mode":"sync"/);
});
