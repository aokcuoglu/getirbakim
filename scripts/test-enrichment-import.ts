import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { storeProductImage } from "../src/modules/enrichment/import";
import { attachProductImage } from "../src/modules/enrichment/image-fill";
import { isPlaceholderImage, placeholderImages, placeholderImageSha256 } from "../src/modules/enrichment/placeholder-images";
import { enrichmentDataSchema } from "../src/modules/store/enrichment-contract";
import { parseView, collectVehicles, parseEngine } from "../src/modules/enrichment/trodo-adapter";
import type { SourceQueue } from "../src/modules/enrichment/source-queue";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const sha256 = createHash("sha256").update(jpeg).digest("hex");

type FakeOptions = { headStatus?: number; corruptPuts?: boolean; ignoresChecksum?: boolean };
/**
 * Object store whose single object starts with the given metadata; records the commands it receives. Like S3 it refuses a
 * PUT whose ChecksumSHA256 does not match the bytes it received (BadDigest) and echoes an accepted one (#1417);
 * `ignoresChecksum` makes it neither check nor echo, `corruptPuts` flips the first byte on arrival, `headStatus` fails HEADs.
 */
function fakeStorage(initial: { length: number; sha256?: string } | null, options: FakeOptions = {}) {
  let object: { length: number; sha256?: string; bytes?: Buffer } | null = initial;
  const calls: string[] = [];
  return { calls, send: async (command: { constructor: { name: string }; input: { Body?: Buffer; Metadata?: Record<string, string>; ChecksumSHA256?: string } }) => {
    calls.push(command.constructor.name);
    if (command.constructor.name === "PutObjectCommand") {
      const bytes = Buffer.from(command.input.Body!);
      if (options.corruptPuts) bytes[0] ^= 0xff;
      const checksum = options.ignoresChecksum ? undefined : command.input.ChecksumSHA256;
      if (checksum !== undefined && checksum !== createHash("sha256").update(bytes).digest("base64")) {
        throw Object.assign(new Error("The SHA256 you specified did not match the calculated checksum."), { name: "BadDigest", $metadata: { httpStatusCode: 400 } });
      }
      object = { length: bytes.length, sha256: command.input.Metadata?.sha256, bytes };
      return checksum === undefined ? {} : { ChecksumSHA256: checksum };
    }
    if (command.constructor.name === "HeadObjectCommand" && options.headStatus) {
      throw Object.assign(new Error(`HTTP ${options.headStatus}`), { $metadata: { httpStatusCode: options.headStatus } });
    }
    if (!object) throw Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } });
    if (command.constructor.name === "GetObjectCommand") return { Body: { transformToByteArray: async () => object!.bytes } };
    return { ContentLength: object.length, Metadata: object.sha256 ? { sha256: object.sha256 } : {} };
  } };
}

async function withImage(run: (file: string, client: PoolClient) => Promise<void>, known = true) {
  const dir = await mkdtemp(join(tmpdir(), "enrichment-import-"));
  process.env.S3_BUCKET ??= "product-media";
  const client = { query: async (sql: string) => ({ rows: sql.startsWith("SELECT") ? (known ? [{ id: "media-1" }] : []) : [{ id: "media-1" }] }) } as unknown as PoolClient;
  try { await writeFile(join(dir, "image.bin"), jpeg); await run(join(dir, "image.bin"), client); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("a known image whose object lost its sha256 metadata is rewritten instead of failing the import", () => withImage(async (file, client) => {
  const storage = fakeStorage({ length: jpeg.length });
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.deepEqual(storage.calls, ["HeadObjectCommand", "PutObjectCommand"]);
}));

test("a known image whose object is missing is restored from the downloaded bytes", () => withImage(async (file, client) => {
  const storage = fakeStorage(null);
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.deepEqual(storage.calls, ["HeadObjectCommand", "PutObjectCommand"]);
}));

test("a known image whose HEAD is answered 403 (a missing key without s3:ListBucket) is written again (#1417)", () => withImage(async (file, client) => {
  const storage = fakeStorage(null, { headStatus: 403 });
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.deepEqual(storage.calls, ["HeadObjectCommand", "PutObjectCommand"]);
}));

test("a new image is written once with its checksum, without a HEAD or a read-back (#1417)", () => withImage(async (file, client) => {
  const storage = fakeStorage(null);
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.deepEqual(storage.calls, ["PutObjectCommand"]);
}, false));

test("a verified known image is not uploaded again", () => withImage(async (file, client) => {
  const storage = fakeStorage({ length: jpeg.length, sha256 });
  await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never);
  assert.deepEqual(storage.calls, ["HeadObjectCommand"]);
}));

test("a store that does not acknowledge the checksum gets the image read back, and other bytes fail the import (#1417)", () => withImage(async (file, client) => {
  const storage = fakeStorage(null, { ignoresChecksum: true });
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.deepEqual(storage.calls, ["PutObjectCommand", "GetObjectCommand"]);
  const corrupting = fakeStorage(null, { ignoresChecksum: true, corruptPuts: true });
  await assert.rejects(storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", corrupting as never), /Stored media integrity failed: products\/[a-f0-9]{2}\/[a-f0-9]{64}\.jpg/);
  assert.deepEqual(corrupting.calls, ["PutObjectCommand", "GetObjectCommand"]);
}, false));

/** A client whose known row is media-1 (none when `known` is false) and whose upsert returns `upserted`; records the SQL it receives in `log`. */
function upsertClient(upserted: string, log: string[] = [], known = true) {
  const sql: string[] = [];
  return { sql, client: { query: async (text: string) => {
    sql.push(text);
    log.push(text.startsWith("SELECT") ? "select" : "upsert");
    return { rows: text.startsWith("SELECT") ? (known ? [{ id: "media-1" }] : []) : [{ id: upserted }] };
  } } as unknown as PoolClient };
}

test("a new image whose upload the store refuses (BadDigest) fails before its row is written (#1417)", () => withImage(async file => {
  const storage = fakeStorage(null, { corruptPuts: true });
  const { client } = upsertClient("media-1", storage.calls, false);
  await assert.rejects(storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), (error: Error) => {
    assert.match(error.message, /^Stored media integrity failed: /);
    assert.equal((error.cause as Error | undefined)?.name, "BadDigest");
    return true;
  });
  assert.deepEqual(storage.calls, ["select", "PutObjectCommand"]);
}));

test("storing a known image marks its row as stored now, so the media collection leaves it", () => withImage(async file => {
  const { sql, client } = upsertClient("media-1");
  const storage = fakeStorage({ length: jpeg.length, sha256 });
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.match(sql.at(-1)!, /ON CONFLICT\(sha256\) DO UPDATE SET stored_at=now\(\) RETURNING id/);
  assert.deepEqual(storage.calls, ["HeadObjectCommand"]);
}));

test("a known object is verified after the upsert and written again when a collection deleted it", () => withImage(async file => {
  // A media:gc batch deleted the object, then rolled its row deletion back: the upsert returns the same id.
  const storage = fakeStorage(null);
  const { client } = upsertClient("media-1", storage.calls);
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.deepEqual(storage.calls, ["select", "upsert", "HeadObjectCommand", "PutObjectCommand"]);
}));

test("a known row the collection removed meanwhile gets a new id and its object written again", () => withImage(async file => {
  const storage = fakeStorage(null);
  const { client } = upsertClient("media-2", storage.calls);
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-2");
  assert.deepEqual(storage.calls, ["select", "upsert", "HeadObjectCommand", "PutObjectCommand"]);
}));

test("a vehicle-list make without model_list parses and leaves its vehicles unresolved", async () => {
  const view = parseView([{ relationships: { oe_numbers: null, attributes: { criteria: [] }, vehicle_ids: ["555001"],
    vehicle_list: { list: { "81234": { automaker_id: "81234", automaker_label: { name: "TEST" } } } } } }]);
  const vehicles = await collectVehicles({ get() { throw Error("A make without models must not fetch"); } } as unknown as SourceQueue, view);
  assert.deepEqual(vehicles.coverage, { expected: 1, covered: 0, unresolved: ["555001"], invalid: [] });
  assert.deepEqual(vehicles.vehicles, []);
});

test("observed large payloads fit the enrichment contract", () => {
  const vehicle = { model: "TEST", engineAndCodes: "1.6", fuel: "Petrol", kw: 80, ps: 109, cc: 1598, from: "01/2010", to: null };
  const base = { specifications: [], oemNumbers: {}, crossReferences: {}, vehicles: [] };
  assert.equal(enrichmentDataSchema.parse({ ...base, vehicles: Array(15042).fill(vehicle) }).vehicles.length, 15042);
  assert.equal(enrichmentDataSchema.parse({ ...base, specifications: [["Note", "x".repeat(3007)]] }).specifications.length, 1);
  assert.throws(() => enrichmentDataSchema.parse({ ...base, specifications: [["Note", "x".repeat(5001)]] }));
});

const engine = (value: string, label: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ value, fuel: "Petrol", label: { engine_fuel: "Petrol", ...label }, ...extra });

test("shifted source labels are rebuilt from the engine line and URL key; year-only rows stay invalid", () => {
  const shifted = parseEngine("RENAULT KANGOO", engine("80948", { name: "1.6 (FW00, FW0E, FW0N,", kw_ps: "kW/PS", year: "FW0Y)", ccm: "64ccm", engine: ["02/2008-0/0 1598ccm K7M 750"] },
    { url_key: "renault-kangoo-express-fw0-1-1-6-64kw-80948-cid" }));
  assert.deepEqual(shifted, { model: "RENAULT KANGOO", engineAndCodes: "1.6 (FW00, FW0E, FW0N, FW0Y) K7M 750", fuel: "Petrol", kw: 64, ps: 87, cc: 1598, from: "02/2008", to: null });
  const powerInYear = parseEngine("RENAULT CLIO", engine("27327", { name: "1.4 16V", kw_ps: "kW/PS", year: "55kW/75PS", ccm: "9ccm", engine: ["02/2000-07/2008 1390ccm K4J 711"] }));
  assert.deepEqual([powerInYear.kw, powerInYear.ps, powerInYear.cc, powerInYear.from, powerInYear.to, powerInYear.engineAndCodes], [55, 75, 1390, "02/2000", "07/2008", "1.4 16V K4J 711"]);
  assert.throws(() => parseEngine("RENAULT KANGOO", engine("46949", { name: "1.6", kw_ps: "kW/PS", year: "64kW/87PS", ccm: "2ccm", engine: ["1598ccm K7M 750"] })), /Malformed source vehicle label/);
  const intact = parseEngine("TEST", engine("1", { name: "1.6", kw_ps: "80kW/109PS", year: "01/2010-0/0", ccm: "1598ccm", engine: ["K4M"] }));
  assert.deepEqual([intact.kw, intact.ps, intact.cc, intact.from, intact.to, intact.engineAndCodes], [80, 109, 1598, "01/2010", null, "1.6 K4M"]);
});

test("hydrogen and fuel-cell engines may have zero displacement, other fuels may not", () => {
  const hydrogen = engine("2", { name: "ë-JUMPY HYDROGEN", kw_ps: "100kW/136PS", year: "01/2021-0/0", ccm: "0ccm", engine_fuel: "Hydrogen/electric" });
  assert.equal(parseEngine("CITROËN JUMPY", hydrogen).cc, 0);
  assert.equal(parseEngine("TOYOTA MIRAI", engine("3", { ...hydrogen.label, engine_fuel: "Fuel Cell" })).cc, 0);
  assert.throws(() => parseEngine("TEST", engine("4", { ...hydrogen.label, engine_fuel: "Petrol" })), /Zero displacement/);
});

test("applicable engines whose model node is missing from vehicle_ids are collected through the remaining models of the listed groups", async () => {
  const view = parseView([{ relationships: { oe_numbers: null, attributes: { criteria: [] }, vehicle_ids: ["38", "1118", "16608", "16610", "16620"],
    vehicle_list: { list: { "38": { automaker_id: "38", automaker_label: { name: "RENAULT" }, model_list: [{ value_id: "1118" }] } } } } }]);
  const listings: Record<string, unknown> = {
    "/rest/V1/vehicle/models/1/1118": [{ relationships: { data: [{ value: "16608", label: { name: "19 I" } }, { value: "16615", label: { name: "19 II" } }, { value: "16625", label: { name: "19 CABRIO" } }] } }],
    "/rest/V1/vehicle/type/1/16608": [{ relationships: { data: [engine("16610", { name: "1.4", kw_ps: "43kW/58PS", year: "01/1989-12/1993", ccm: "1397ccm" })] } }],
    "/rest/V1/vehicle/type/1/16615": [{ relationships: { data: [engine("16620", { name: "1.7", kw_ps: "54kW/73PS", year: "01/1992-12/1995", ccm: "1721ccm" }), engine("16621", { name: "1.9 D", kw_ps: "47kW/64PS", year: "01/1992-12/1995", ccm: "1870ccm" })] } }],
  };
  const requested: string[] = [];
  const queue = { async get(_host: string, path: string) { requested.push(path); if (!(path in listings)) throw Error("Unexpected " + path); return listings[path]; } } as unknown as SourceQueue;
  const vehicles = await collectVehicles(queue, view);
  assert.deepEqual(vehicles.coverage, { expected: 5, covered: 5, unresolved: [], invalid: [] });
  assert.deepEqual(vehicles.vehicles.map(v => [v.model, v.engineAndCodes]), [["RENAULT 19 I", "1.4"], ["RENAULT 19 II", "1.7"]]);
  assert.deepEqual(vehicles.vehicleModels, ["RENAULT 19 I", "RENAULT 19 II"]);
  assert.deepEqual(requested, ["/rest/V1/vehicle/models/1/1118", "/rest/V1/vehicle/type/1/16608", "/rest/V1/vehicle/type/1/16615"]);
  const bounded = await collectVehicles(queue, view, 0);
  assert.deepEqual(bounded.coverage.unresolved, ["16620"]);
});

test("a listed placeholder is recognised by its bytes, anything else is not (#1098)", () => {
  assert.equal(isPlaceholderImage(jpeg), false);
  assert.equal(isPlaceholderImage(jpeg, new Set([sha256])), true);
  assert.equal(isPlaceholderImage(Buffer.from("other"), new Set([sha256])), false);
  assert.equal(isPlaceholderImage(jpeg, new Set()), false);
});

test("the placeholder list holds unique, sorted sha256 keys, each with a source and a note (#1098)", () => {
  assert.ok(placeholderImages.length > 0);
  for (const image of placeholderImages) {
    assert.match(image.sha256, /^[a-f0-9]{64}$/);
    assert.ok(image.source.trim(), image.sha256);
    assert.ok(image.note.trim(), image.sha256);
  }
  const keys = placeholderImages.map(image => image.sha256);
  assert.equal(placeholderImageSha256.size, keys.length, "no duplicates");
  assert.deepEqual(keys, [...keys].sort(), "sorted by sha256");
});

test("image fill skips a listed placeholder without touching the database (#1098)", () => withImage(async file => {
  const pool = { connect: async () => { throw new Error("must not connect"); } } as unknown as Pool;
  const image = { supplierItemId: "00000000-0000-0000-0000-000000000001", file, source: "https://cdn.spareto.com/a.jpg", width: 10, height: 10 };
  assert.equal(await attachProductImage(pool, image, new Set([sha256])), "skipped");
  await assert.rejects(attachProductImage(pool, image, new Set()), /must not connect/);
}));
