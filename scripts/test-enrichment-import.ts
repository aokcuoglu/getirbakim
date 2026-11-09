import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { storeProductImage } from "../src/modules/enrichment/import";
import { enrichmentDataSchema } from "../src/modules/store/enrichment-contract";
import { parseView, collectVehicles, parseEngine } from "../src/modules/enrichment/trodo-adapter";
import type { SourceQueue } from "../src/modules/enrichment/source-queue";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const sha256 = createHash("sha256").update(jpeg).digest("hex");

/** Object store whose single object starts with the given metadata; records the commands it receives. */
function fakeStorage(initial: { length: number; sha256?: string } | null, keepsMetadata = true) {
  let object = initial;
  const calls: string[] = [];
  return { calls, send: async (command: { constructor: { name: string }; input: { Body?: Buffer; Metadata?: Record<string, string> } }) => {
    calls.push(command.constructor.name);
    if (command.constructor.name === "PutObjectCommand") {
      object = { length: command.input.Body!.length, sha256: keepsMetadata ? command.input.Metadata?.sha256 : undefined };
      return {};
    }
    if (!object) throw Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } });
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
  assert.deepEqual(storage.calls, ["HeadObjectCommand", "PutObjectCommand", "HeadObjectCommand"]);
}));

test("a known image whose object is missing is restored from the downloaded bytes", () => withImage(async (file, client) => {
  const storage = fakeStorage(null);
  assert.equal(await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), "media-1");
  assert.deepEqual(storage.calls, ["HeadObjectCommand", "PutObjectCommand", "HeadObjectCommand"]);
}));

test("a verified known image is not uploaded again", () => withImage(async (file, client) => {
  const storage = fakeStorage({ length: jpeg.length, sha256 });
  await storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never);
  assert.deepEqual(storage.calls, ["HeadObjectCommand"]);
}));

test("storage that still cannot be verified after a rewrite fails the import", () => withImage(async (file, client) => {
  await assert.rejects(storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", fakeStorage({ length: jpeg.length }, false) as never), /Object verification failed/);
}));

test("a new image that fails verification is not retried", () => withImage(async (file, client) => {
  const storage = fakeStorage(null, false);
  await assert.rejects(storeProductImage(client, file, "https://picdn.trodo.com/a.jpg", storage as never), /Object verification failed/);
  assert.deepEqual(storage.calls, ["PutObjectCommand", "HeadObjectCommand"]);
}, false));

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
