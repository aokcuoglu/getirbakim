import test from "node:test";
import assert from "node:assert/strict";

// Run with --test-force-exit: the Valkey clients keep reconnecting in the background.
// The handler picks its store from CACHE_URL when the module loads, so each case imports a fresh module instance.
type Handler = { get(key: string, ctx?: unknown): Promise<{ lastModified: number; value: unknown } | null>;
  set(key: string, value: unknown, ctx?: unknown): Promise<void>; revalidateTag(tags: string | string[]): Promise<void> };
async function load(env: Record<string, string | undefined>, tag: string) {
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  const module = await import(`../cache-handler.mjs?${tag}`);
  return { handler: new module.default() as Handler, internals: module.__test__ };
}
const page = (tags: string) => ({ kind: "APP_PAGE", html: "<p>hi</p>", rscData: Buffer.from("rsc"), status: 200,
  headers: { "x-next-cache-tags": tags }, postponed: undefined, segmentData: new Map([["/_index", Buffer.from("seg")]]) });
const pause = () => new Promise(done => setTimeout(done, 5));

test("Buffers and Maps survive serialization", async () => {
  const { internals } = await load({ CACHE_URL: undefined }, "serialize");
  const value = page("_N_T_/katalog");
  const copy = internals.deserialize(internals.serialize({ lastModified: 1, tags: [], value })).value;
  assert.ok(Buffer.isBuffer(copy.rscData));
  assert.equal(copy.rscData.toString(), "rsc");
  assert.ok(copy.segmentData instanceof Map);
  assert.equal(copy.segmentData.get("/_index").toString(), "seg");
});

test("tags come from the page header and from a fetch's tags and soft tags", async () => {
  const { internals } = await load({ CACHE_URL: undefined }, "tags");
  assert.deepEqual(internals.entryTags(page("a,b"), {}), ["a", "b"]);
  assert.deepEqual(internals.entryTags({ kind: "FETCH", data: {} }, { tags: ["x"], softTags: ["_N_T_/y"] }), ["x", "_N_T_/y"]);
  assert.equal(internals.ttlSeconds({ cacheControl: { revalidate: 60, expire: 300 } }), 300);
  assert.equal(internals.ttlSeconds({ revalidate: false }), 30 * 24 * 60 * 60);
});

test("without CACHE_URL the in-process store caches and honours revalidateTag", async () => {
  const { handler } = await load({ CACHE_URL: undefined }, "memory");
  await handler.set("/katalog", page("_N_T_/katalog"), { cacheControl: { revalidate: 60 } });
  assert.equal((await handler.get("/katalog"))?.value && "hit", "hit");
  await pause();
  await handler.revalidateTag("_N_T_/other");
  assert.ok(await handler.get("/katalog"), "an unrelated tag keeps the entry");
  await handler.revalidateTag(["_N_T_/katalog"]);
  assert.equal(await handler.get("/katalog"), null);
});

test("an unreachable Valkey is a cache miss, never an error", async () => {
  const { handler } = await load({ CACHE_URL: "redis://127.0.0.1:1", CACHE_AUTH_TOKEN: undefined }, "down");
  await handler.set("/katalog", page("_N_T_/katalog"), {});
  assert.equal(await handler.get("/katalog"), null);
  await handler.revalidateTag("_N_T_/katalog");
});

// Runs when a Valkey/Redis is available, e.g. TEST_CACHE_URL=redis://127.0.0.1:6390 TEST_CACHE_AUTH_TOKEN=secret
test("Valkey store is shared between handler instances", { skip: !process.env.TEST_CACHE_URL }, async () => {
  const env = { CACHE_URL: process.env.TEST_CACHE_URL, CACHE_AUTH_TOKEN: process.env.TEST_CACHE_AUTH_TOKEN, BUILD_VERSION: `test-${Date.now()}` };
  const first = (await load(env, "valkey-a")).handler;
  const second = (await load(env, "valkey-b")).handler;
  // The client connects in the background; writes are skipped until it is ready.
  for (let i = 0; i < 100 && !(await first.get("/warmup")); i++) { await first.set("/warmup", page("w"), {}); await pause(); }
  for (let i = 0; i < 100 && !(await second.get("/warmup")); i++) await pause();
  await first.set("/katalog", page("_N_T_/katalog"), { cacheControl: { revalidate: 60 } });
  const hit = await second.get("/katalog") as { value: ReturnType<typeof page> } | null;
  assert.ok(hit, "a second task reads the entry the first task wrote");
  assert.equal(hit.value.rscData.toString(), "rsc");
  await pause();
  await second.revalidateTag("_N_T_/katalog");
  assert.equal(await first.get("/katalog"), null, "a revalidation on one task reaches the other");
});
