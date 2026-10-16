import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { storeProductImage } from "../src/modules/enrichment/import";
import { enrichmentDataSchema } from "../src/modules/store/enrichment-contract";
import { parseView, collectVehicles } from "../src/modules/enrichment/trodo-adapter";
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
