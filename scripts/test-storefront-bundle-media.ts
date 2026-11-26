import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import type { S3Client } from "@aws-sdk/client-s3";
import { DEFAULT_MEDIA_CONCURRENCY, ensureStoredObject, ensureStoredObjects, type MediaTarget, mediaConcurrency, mediaToRecheck,
  type PlannedMedia } from "./storefront-bundle-media";

// The bundle media store of import-storefront-bundle.ts (#1406) and its checksummed write (#1417, src/lib/stored-object.ts),
// against an in-memory object store; the e2e (test-storefront-e2e.ts) runs it through the real importer and an S3 stub.

type FakeObject = { bytes: Uint8Array; contentType?: string; metadata?: Record<string, string> };
type Input = { Bucket: string; Key: string; Body?: Uint8Array; ContentType?: string; Metadata?: Record<string, string>; ChecksumSHA256?: string };
type FakeOptions = { headStatus?: Record<string, number>; corruptPuts?: Set<string>; ignoresChecksum?: boolean };

const checksumOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64");

/**
 * An object store keyed by bucket/key that records "<Head|Put|Get> bucket/key" per command. Like S3 it refuses a PUT whose
 * ChecksumSHA256 does not match the bytes it received (BadDigest) and echoes an accepted one; `ignoresChecksum` makes it
 * neither check nor echo. `headStatus` makes a key's HEAD fail with that status; `corruptPuts` flips a key's first byte on arrival.
 */
function fakeStorage(initial: Record<string, FakeObject> = {}, options: FakeOptions = {}) {
  const objects = new Map(Object.entries(initial));
  const calls: string[] = [], puts: Input[] = [];
  let inFlight = 0, maxInFlight = 0;
  const send = async (command: { constructor: { name: string }; input: Input }) => {
    const key = `${command.input.Bucket}/${command.input.Key}`;
    const name = command.constructor.name.replace(/ObjectCommand$/, "");
    calls.push(`${name} ${key}`);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise(resolve => setTimeout(resolve, 1));
      if (name === "Put") {
        puts.push(command.input);
        const bytes = Buffer.from(command.input.Body!);
        if (options.corruptPuts?.has(key)) bytes[0] ^= 0xff;
        const checksum = options.ignoresChecksum ? undefined : command.input.ChecksumSHA256;
        if (checksum !== undefined && checksum !== checksumOf(bytes)) {
          throw Object.assign(new Error("The SHA256 you specified did not match the calculated checksum."), { name: "BadDigest", $metadata: { httpStatusCode: 400 } });
        }
        objects.set(key, { bytes, contentType: command.input.ContentType, metadata: command.input.Metadata });
        return checksum === undefined ? {} : { ChecksumSHA256: checksum };
      }
      const status = name === "Head" ? options.headStatus?.[key] : undefined;
      const object = objects.get(key);
      if (status || !object) throw Object.assign(new Error(`HTTP ${status ?? 404}`), { $metadata: { httpStatusCode: status ?? 404 } });
      if (name === "Head") return { ContentLength: object.bytes.length, Metadata: object.metadata ?? {} };
      return { Body: { transformToByteArray: async () => object.bytes } };
    } finally { inFlight--; }
  };
  return { objects, calls, puts, maxInFlight: () => maxInFlight, storage: { send } as unknown as Pick<S3Client, "send"> };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function media(name: string) {
  const bytes = randomBytes(32), sha = sha256(bytes);
  const target: MediaTarget = { sha256: sha, bucket: "media", object_key: `${name}/${sha}.png`, content_type: "image/png" };
  return { bytes, target, path: `media/${target.object_key}` };
}
const stored = (object: ReturnType<typeof media>, overrides: Partial<FakeObject> = {}): FakeObject =>
  ({ bytes: object.bytes, contentType: "image/png", metadata: { sha256: object.target.sha256 }, ...overrides });

test("an object with its size and sha256 metadata costs one HEAD", async () => {
  const object = media("a");
  const fake = fakeStorage({ [object.path]: stored(object) });
  assert.equal(await ensureStoredObject(fake.storage, object.target, object.bytes), "verified");
  assert.deepEqual(fake.calls, [`Head ${object.path}`]);
});

test("a missing object is written with its type, sha256 metadata and checksum, and not read back (#1417)", async () => {
  const object = media("a");
  const fake = fakeStorage();
  assert.equal(await ensureStoredObject(fake.storage, object.target, object.bytes), "uploaded");
  assert.deepEqual(fake.calls, [`Head ${object.path}`, `Put ${object.path}`]);
  assert.equal(fake.puts[0].ContentType, "image/png");
  assert.deepEqual(fake.puts[0].Metadata, { sha256: object.target.sha256 });
  // The base64 of the 32 raw sha256 bytes, as S3 expects in x-amz-checksum-sha256.
  assert.equal(fake.puts[0].ChecksumSHA256, Buffer.from(object.target.sha256, "hex").toString("base64"));
  assert.equal(fake.puts[0].ChecksumSHA256, checksumOf(object.bytes));
  assert.deepEqual(fake.objects.get(object.path)?.bytes, object.bytes);
});

test("a HEAD answered 403 (a missing key without s3:ListBucket) uploads", async () => {
  const object = media("a");
  const fake = fakeStorage({}, { headStatus: { [object.path]: 403 } });
  assert.equal(await ensureStoredObject(fake.storage, object.target, object.bytes), "uploaded");
  assert.deepEqual(fake.calls, [`Head ${object.path}`, `Put ${object.path}`]);
});

test("an object of another size is rewritten", async () => {
  const object = media("a");
  const fake = fakeStorage({ [object.path]: stored(object, { bytes: object.bytes.subarray(0, 16) }) });
  assert.equal(await ensureStoredObject(fake.storage, object.target, object.bytes), "uploaded");
  assert.deepEqual(fake.objects.get(object.path)?.bytes, object.bytes);
});

test("an object without sha256 metadata (or with another one) is rewritten and stamped", async () => {
  for (const metadata of [undefined, {}, { sha256: "0".repeat(64) }] as (Record<string, string> | undefined)[]) {
    const object = media("a");
    const fake = fakeStorage({ [object.path]: stored(object, { metadata }) });
    assert.equal(await ensureStoredObject(fake.storage, object.target, object.bytes), "uploaded");
    assert.deepEqual(fake.objects.get(object.path)?.metadata, { sha256: object.target.sha256 });
  }
});

test("a HEAD failing otherwise throws without writing", async () => {
  const object = media("a");
  const fake = fakeStorage({}, { headStatus: { [object.path]: 500 } });
  await assert.rejects(ensureStoredObject(fake.storage, object.target, object.bytes), /HTTP 500/);
  assert.deepEqual(fake.calls, [`Head ${object.path}`]);
});

test("an upload whose checksum the store refuses fails the integrity check, without a read-back or a stored object (#1417)", async () => {
  const object = media("a");
  const fake = fakeStorage({}, { corruptPuts: new Set([object.path]) });
  await assert.rejects(ensureStoredObject(fake.storage, object.target, object.bytes), (error: Error) => {
    assert.equal(error.message, `Stored media integrity failed: ${object.target.object_key}`);
    assert.equal((error.cause as Error | undefined)?.name, "BadDigest");
    return true;
  });
  assert.deepEqual(fake.calls, [`Head ${object.path}`, `Put ${object.path}`]);
  assert.ok(!fake.objects.has(object.path));
});

test("bytes other than the expected sha256 are refused: the checksum is the target's sha256, not a hash of the bytes (#1417)", async () => {
  const [object, other] = [media("a"), media("b")];
  const fake = fakeStorage();
  await assert.rejects(ensureStoredObject(fake.storage, object.target, other.bytes), { message: `Stored media integrity failed: ${object.target.object_key}` });
  assert.ok(!fake.objects.has(object.path));
});

test("a store that does not acknowledge the checksum gets the object read back (#1417)", async () => {
  const object = media("a");
  const fake = fakeStorage({}, { ignoresChecksum: true });
  assert.equal(await ensureStoredObject(fake.storage, object.target, object.bytes), "uploaded");
  assert.deepEqual(fake.calls, [`Head ${object.path}`, `Put ${object.path}`, `Get ${object.path}`]);
});

test("on a store that ignores the checksum, a written object that reads back other bytes fails the integrity check", async () => {
  const object = media("a");
  const fake = fakeStorage({}, { ignoresChecksum: true, corruptPuts: new Set([object.path]) });
  await assert.rejects(ensureStoredObject(fake.storage, object.target, object.bytes), { message: `Stored media integrity failed: ${object.target.object_key}` });
  assert.deepEqual(fake.calls, [`Head ${object.path}`, `Put ${object.path}`, `Get ${object.path}`]);
});

test("ensureStoredObjects counts verified and uploaded objects and handles a bucket/key once", async () => {
  const objects = ["a", "b", "c", "d", "e"].map(media);
  const fake = fakeStorage(Object.fromEntries(objects.slice(0, 3).map(object => [object.path, stored(object)])));
  const bytes = new Map(objects.map(object => [object.target.sha256, object.bytes]));
  const counts = await ensureStoredObjects(fake.storage, [...objects.map(object => object.target), objects[0].target, objects[4].target], sha => bytes.get(sha)!, 3);
  assert.deepEqual(counts, { verified: 3, uploaded: 2 });
  assert.equal(fake.calls.filter(call => call.startsWith("Head ")).length, 5);
  assert.deepEqual(fake.puts.map(input => `${input.Bucket}/${input.Key}`).sort(), [objects[3].path, objects[4].path].sort());
});

test("two sha256 values on one bucket/key stop before anything is sent", async () => {
  const [a, b] = [media("a"), media("b")];
  const fake = fakeStorage();
  await assert.rejects(ensureStoredObjects(fake.storage, [a.target, { ...b.target, object_key: a.target.object_key }], () => a.bytes, 2), /share one object key/);
  assert.deepEqual(fake.calls, []);
});

test("no more than `concurrency` objects are in flight", async () => {
  const objects = Array.from({ length: 20 }, (_, index) => media(`n${index}`));
  const bytes = new Map(objects.map(object => [object.target.sha256, object.bytes]));
  for (const concurrency of [1, 4]) {
    const fake = fakeStorage();
    assert.deepEqual(await ensureStoredObjects(fake.storage, objects.map(object => object.target), sha => bytes.get(sha)!, concurrency), { verified: 0, uploaded: 20 });
    assert.equal(fake.maxInFlight(), concurrency);
  }
});

test("after a failure no further object starts and the call rejects with it", async () => {
  const objects = Array.from({ length: 6 }, (_, index) => media(`n${index}`));
  const bytes = new Map(objects.map(object => [object.target.sha256, object.bytes]));
  const fake = fakeStorage(Object.fromEntries(objects.map(object => [object.path, stored(object)])), { headStatus: { [objects[0].path]: 500 } });
  await assert.rejects(ensureStoredObjects(fake.storage, objects.map(object => object.target), sha => bytes.get(sha)!, 2), /HTTP 500/);
  // The first two started together; the second finished, then saw the failure.
  assert.deepEqual(fake.calls, [`Head ${objects[0].path}`, `Head ${objects[1].path}`]);
});

test("an invalid concurrency is refused", async () => {
  await assert.rejects(ensureStoredObjects(fakeStorage().storage, [media("a").target], () => Buffer.alloc(0), 0), /Invalid media concurrency/);
});

test("STOREFRONT_MEDIA_CONCURRENCY defaults to 8 and takes 1 to 32", () => {
  assert.equal(DEFAULT_MEDIA_CONCURRENCY, 8);
  assert.equal(mediaConcurrency({}), 8);
  assert.equal(mediaConcurrency({ STOREFRONT_MEDIA_CONCURRENCY: "" }), 8);
  assert.equal(mediaConcurrency({ STOREFRONT_MEDIA_CONCURRENCY: "1" }), 1);
  assert.equal(mediaConcurrency({ STOREFRONT_MEDIA_CONCURRENCY: "32" }), 32);
  for (const value of ["0", "33", "-1", "2.5", "08", "x", " 4"]) {
    assert.throws(() => mediaConcurrency({ STOREFRONT_MEDIA_CONCURRENCY: value }), /STOREFRONT_MEDIA_CONCURRENCY must be an integer from 1 to 32/, value);
  }
});

test("mediaToRecheck keeps only the rows the pre-transaction pass could not vouch for", () => {
  const row = (name: string, overrides: Partial<MediaTarget> = {}): MediaTarget => ({ sha256: name.repeat(64).slice(0, 64), bucket: "media", object_key: `k/${name}.png`, content_type: "image/png", ...overrides });
  const plan = (target: MediaTarget, known: boolean): PlannedMedia => ({ ...target, known });
  const [known, fresh, gcRaced, raced, moved, unplanned] = ["a", "b", "c", "d", "e", "f"].map(name => row(name));
  const planned = [plan(known, true), plan(fresh, false), plan(gcRaced, true), plan(raced, false), plan(moved, true)];
  const current = [known, fresh, gcRaced, raced, { ...moved, object_key: "k/elsewhere.png" }, unplanned];
  // fresh was inserted as planned; gcRaced was known before yet inserted (media:gc removed it meanwhile); raced was new
  // before yet not inserted (another writer); unplanned was never read before the transaction.
  const inserted = new Set([fresh.sha256, gcRaced.sha256]);
  assert.deepEqual(mediaToRecheck(planned, current, inserted).map(target => target.sha256), [gcRaced, raced, moved, unplanned].map(target => target.sha256));
  assert.deepEqual(mediaToRecheck(planned, [known, fresh], inserted), []);
  assert.deepEqual(mediaToRecheck(planned, [{ ...known, bucket: "other" }], inserted).length, 1);
});
