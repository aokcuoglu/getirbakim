import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { staleCache, type StaleCacheStore } from "../src/lib/stale-cache";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// Storefront listing caches and the listing epoch (#585) in an isolated copy of the schema: an admin edit bumps the
// epoch and the cached counts, category ids and plain searches reload; without a bump they keep serving the old value.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let overrides: typeof import("../src/modules/admin/product-override-store");
let references: typeof import("../src/modules/admin/product-reference-store");
let epoch: typeof import("../src/modules/store/listing-epoch");
let cacheStore: typeof import("../src/modules/store/listing-cache-store");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();
let admin: string;

async function item(key: string, code: string, brand: string, name: string) {
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [basbug, code, { uk: brand, ac: name, ac2: "", dc: "TL" }]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const newestTotal = async () => (await catalog.browseProducts({ sort: "newest" })).total;

before(async () => {
  schema = await isolatedSchema("listing_cache_test");
  await item("mahle", "MAH 20020", "MAHLE", "MAHLE YAG FILTRESI");
  await item("ngk", "NGK 30030", "NGK", "NGK BUJI");
  await item("skf", "SKF 40040", "SKF", "SKF RULMAN");
  await item("sachs", "SACHS 50050", "SACHS", "SACHS AMORTISOR");
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
    VALUES('trodo',200,NULL,'Rulmanlar','rulmanlar','{200}','','{}')`);
  const [{ db }, catalogModule, overridesModule, referencesModule, epochModule, storeModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/store/catalog"), import("../src/modules/admin/product-override-store"),
    import("../src/modules/admin/product-reference-store"), import("../src/modules/store/listing-epoch"),
    import("../src/modules/store/listing-cache-store")]);
  catalog = catalogModule;
  overrides = overridesModule;
  references = referencesModule;
  epoch = epochModule;
  cacheStore = storeModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("without an epoch the cache serves stale values and refreshes in the background", async () => {
  const cache = staleCache<number>(20);
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await cache("k", load), 1);
  assert.equal(await cache("k", load), 1);
  await sleep(30);
  // Past the TTL the old value is served while one refresh runs.
  assert.equal(await cache("k", load), 1);
  await sleep(5);
  assert.equal(await cache("k", load), 2);
  assert.equal(loads, 2);
});

test("an epoch change makes callers wait for one shared reload; a failed reload serves the old value", async () => {
  let current = 0, loads = 0;
  const cache = staleCache<string>(60_000, 500, { epoch: async () => current });
  const load = async () => `v${++loads}`;
  assert.equal(await cache("k", load), "v1");
  assert.equal(await cache("k", load), "v1", "same epoch is a hit");
  current = 1;
  const [a, b] = await Promise.all([cache("k", load), cache("k", load)]);
  assert.deepEqual([a, b], ["v2", "v2"], "concurrent callers share the reload");
  assert.equal(loads, 2);
  current = 2;
  const failing = async (): Promise<string> => { throw new Error("database down"); };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await cache("k", failing), "v2", "a failed reload serves the previous value");
  } finally { console.error = originalError; }
  assert.equal(await cache("k", load), "v3", "the next request tries again");
  assert.equal(await cache("k", load), "v3");
});

test("hiding a product leaves the cached listing until the epoch is bumped", async () => {
  const total = await newestTotal();
  assert.ok(total >= 4);
  const saved = await overrides.persistProductOverride(schema.pool, await productOf("ngk"), { hidden: true }, admin);
  assert.ok(saved.ok && saved.changed.includes("hidden"));
  assert.equal(await newestTotal(), total, "no bump: the cached count is served");
  await epoch.invalidateListings();
  assert.equal(await newestTotal(), total - 1);
});

test("a category edit and an added reference reach the cached category ids and code search after a bump", async () => {
  assert.deepEqual(await catalog.categoryProductIds([], [200]), []);
  const saved = await overrides.persistProductOverride(schema.pool, await productOf("skf"), { category_id: 200 }, admin);
  assert.ok(saved.ok && saved.changed.includes("category_id"));
  assert.deepEqual(await catalog.categoryProductIds([], [200]), [], "no bump: the cached ids are served");
  await epoch.invalidateListings();
  assert.deepEqual(await catalog.categoryProductIds([], [200]), [ids.skf]);

  const search = async () => (await catalog.browseProducts({ q: "5Q0615301", searchBy: "code" })).items.map(row => row.id);
  assert.deepEqual(await search(), []);
  const added = await references.addProductReference(schema.pool, await productOf("mahle"), { kind: "oem", brand: "VW", number: "5Q0 615 301" }, admin);
  assert.ok(added.ok);
  assert.deepEqual(await search(), [], "no bump: the cached search is served");
  await epoch.invalidateListings();
  assert.deepEqual(await search(), [ids.mahle]);
});

test("a bump from another app process is seen within about a second", async () => {
  const total = await newestTotal();
  await overrides.persistProductOverride(schema.pool, await productOf("sachs"), { hidden: true }, admin);
  // Another container's invalidateListings(): only the shared counter moves.
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=epoch+1,bumped_at=now()");
  await sleep(1100);
  assert.equal(await newestTotal(), total - 1);
});

test("the admin actions that change listings bump the epoch", async () => {
  const calls = async (file: string) => ((await readFile(file, "utf8")).match(/invalidateListings\(/g) ?? []).length;
  // splitSource, undoSplitSource, mergeProducts and saveProductOverride.
  assert.equal(await calls("src/app/yonetim/urunler/actions.ts"), 4);
  // run(), shared by add, hide and remove; setSupplierOemHidden (#615).
  assert.equal(await calls("src/app/yonetim/urunler/reference-actions.ts"), 2);
  // splitOffer, undoSplit, decideCandidate ("Aynı ürün"), acceptCandidates and brandDecision (confirm, rename, move and
  // merge of master brands: the store shows master brand names, #811).
  assert.equal(await calls("src/app/yonetim/urun-eslestirme/actions.ts"), 5);
  // run() for remove and the automatic-image switch, finishProductImageUpload (#596).
  assert.equal(await calls("src/app/yonetim/urunler/image-actions.ts"), 2);
});

test("the home rails pick skips admin-hidden products and reloads on an epoch bump (#650)", async () => {
  const home = await readFile("src/modules/store/home.ts", "utf8");
  assert.match(home, /staleCache<string\[\]>\([^)]*\{epoch:listingEpoch\}\)/);
  assert.match(home, /NOT EXISTS \(SELECT 1 FROM commerce_item_overrides h WHERE h\.supplier_item_id=s\.id AND h\.hidden\)/);
  // Both arms (#596): the automatic one skips hidden automatic images, the upload one reads the uploads.
  assert.equal(home.match(/NOT EXISTS \(SELECT 1 FROM commerce_item_overrides h WHERE h\.supplier_item_id=s\.id AND h\.hidden\)/g)?.length, 2);
  assert.match(home, /product_override_images/);
  assert.match(home, /hiddenAutomaticItemsSql/);
});

// The persisted level (#957): a store shared by every process, here an in-memory fake with explicit ages.
/** Polls `read` until `done` holds or the deadline passes (the stores write without being awaited). */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(10);
  }
}
function fakeStore<T>() {
  const rows = new Map<string, { value: T; writtenAt: number; epoch: number }>();
  let reads = 0, writes = 0;
  const store: StaleCacheStore<T> = {
    async read(key) {
      reads++;
      const row = rows.get(key);
      return row ? { value: row.value, epoch: row.epoch, ageMs: Date.now() - row.writtenAt } : null;
    },
    async write(key, value, at) {
      writes++;
      const row = rows.get(key);
      if (!row || at >= row.epoch) rows.set(key, { value, writtenAt: Date.now(), epoch: at });
    },
  };
  const put = (key: string, value: T, ageMs: number, at = 0) => rows.set(key, { value, writtenAt: Date.now() - ageMs, epoch: at });
  return { store, rows, put, counts: () => ({ reads, writes }) };
}

test("a second process adopts the value the first one stored instead of loading it", async () => {
  const shared = fakeStore<number>();
  const first = staleCache<number>(60_000, 500, { store: shared.store, maxStaleMs: 600_000 });
  const second = staleCache<number>(60_000, 500, { store: shared.store, maxStaleMs: 600_000 });
  assert.equal(await first("k", async () => 41), 41);
  await sleep(5);
  assert.equal(shared.rows.get("k")?.value, 41, "the load was written back");
  let loads = 0;
  assert.equal(await second("k", async () => ++loads), 41);
  assert.equal(loads, 0);
});

test("a stored value past the TTL is served once and refreshed in the background", async () => {
  const shared = fakeStore<string>();
  shared.put("k", "old", 100);
  const cache = staleCache<string>(50, 500, { store: shared.store, maxStaleMs: 10_000 });
  let loads = 0;
  const load = async () => `new${++loads}`;
  assert.equal(await cache("k", load), "old", "the stored value is served at once");
  await sleep(10);
  assert.equal(loads, 1, "one background refresh");
  assert.equal(await cache("k", load), "new1");
  assert.equal(shared.rows.get("k")?.value, "new1", "the refresh is written back");
  assert.equal(loads, 1);
});

test("a stored value older than maxStaleMs or from an older epoch is a miss", async () => {
  const shared = fakeStore<string>();
  shared.put("old", "stored", 2_000);
  shared.put("epoch", "stored", 0, 1);
  const cache = staleCache<string>(50, 500, { store: shared.store, maxStaleMs: 1_000, epoch: async () => 2 });
  assert.equal(await cache("old", async () => "loaded"), "loaded");
  assert.equal(await cache("epoch", async () => "loaded"), "loaded");
  await sleep(5);
  assert.equal(shared.rows.get("old")?.value, "loaded");
  assert.deepEqual([shared.rows.get("epoch")?.value, shared.rows.get("epoch")?.epoch], ["loaded", 2]);
});

test("a TTL refresh or an epoch reload adopts a fresher value another process stored", async () => {
  const shared = fakeStore<string>();
  let current = 0, loads = 0;
  const cache = staleCache<string>(30, 500, { store: shared.store, maxStaleMs: 10_000, epoch: async () => current });
  const load = async () => `loaded${++loads}`;
  assert.equal(await cache("k", load), "loaded1");
  await sleep(40);
  shared.put("k", "other process", 0);
  assert.equal(await cache("k", load), "loaded1", "past the TTL the old value is served");
  await sleep(5);
  assert.equal(await cache("k", load), "other process");
  current = 1;
  shared.put("k", "after the bump", 0, 1);
  assert.equal(await cache("k", load), "after the bump", "the reload reads the store first");
  assert.equal(loads, 1);
});

test("persist: false keeps a key in memory only; a failing store still returns the loaded value", async () => {
  const shared = fakeStore<number>();
  const cache = staleCache<number>(60_000, 500, { store: shared.store });
  assert.equal(await cache("k", async () => 1, { persist: false }), 1);
  await sleep(5);
  assert.deepEqual(shared.counts(), { reads: 0, writes: 0 });
  const broken: StaleCacheStore<number> = {
    read: async () => { throw new Error("database down"); },
    write: () => { throw new Error("database down"); },
  };
  const failing = staleCache<number>(60_000, 500, { store: broken });
  assert.equal(await failing("k", async () => 7), 7);
  assert.equal(await failing("k", async () => 8), 7);
});

test("listingCacheStore round-trips values and never lets an older epoch overwrite a newer row", async () => {
  const counts = cacheStore.listingCacheStore<number>("test-count", 1);
  const ids = cacheStore.listingCacheStore<string[]>("test-ids", 1);
  const facets = cacheStore.listingCacheStore<{ brands: string[]; attributes: { key: string; options: string[] }[] }>("test-facets", 1);
  await counts.write("a", 42, 3);
  await ids.write("a", ["x", "y"], 3);
  await facets.write("a", { brands: ["BOSCH"], attributes: [{ key: "Çap", options: ["10 mm"] }] }, 3);
  const count = await counts.read("a");
  assert.equal(count?.value, 42);
  assert.equal(count?.epoch, 3);
  assert.ok(count && count.ageMs >= 0 && count.ageMs < 60_000);
  assert.deepEqual((await ids.read("a"))?.value, ["x", "y"]);
  assert.deepEqual((await facets.read("a"))?.value, { brands: ["BOSCH"], attributes: [{ key: "Çap", options: ["10 mm"] }] });
  assert.equal(await counts.read("missing"), null);
  await counts.write("a", 1, 2);
  assert.equal((await counts.read("a"))?.value, 42, "an older epoch does not overwrite");
  await counts.write("a", 43, 4);
  assert.deepEqual([(await counts.read("a"))?.value, (await counts.read("a"))?.epoch], [43, 4]);
  // Another version is another key.
  assert.equal(await cacheStore.listingCacheStore<number>("test-count", 2).read("a"), null);
});

test("listingCacheStore skips values over 256 KB and is off with LISTING_CACHE_PERSIST=0", async () => {
  const ids = cacheStore.listingCacheStore<string[]>("test-ids", 1);
  await ids.write("large", Array.from({ length: 10_000 }, (_, i) => `${i}`.padStart(30, "0")), 1);
  assert.equal(await ids.read("large"), null, "over 256 KB serialized: not stored");
  await ids.write("small", ["x"], 1);
  try {
    process.env.LISTING_CACHE_PERSIST = "0";
    assert.equal(await ids.read("small"), null, "off: a stored row is not read");
    await ids.write("off", ["y"], 1);
  } finally { delete process.env.LISTING_CACHE_PERSIST; }
  assert.deepEqual((await ids.read("small"))?.value, ["x"]);
  assert.equal(await ids.read("off"), null, "off: nothing was written");
});

test("plain and make listings persist their count, page ids and facets; searches, brand filters and models do not", async () => {
  await schema.pool.query("TRUNCATE storefront_listing_cache");
  await epoch.invalidateListings();
  const stored = async () => (await schema.pool.query<{ namespace: string; n: number }>(
    "SELECT namespace,count(*)::int AS n FROM storefront_listing_cache GROUP BY namespace ORDER BY namespace")).rows;
  // Not persisted: a search, a brand filter and a model listing (too many keys).
  await catalog.browseProducts({ q: "MAHLE" });
  await catalog.browseProducts({ brands: JSON.stringify(["MAHLE"]) });
  await catalog.browseProducts({ make: "volkswagen", model: "golf" });
  await catalog.catalogFacets({ make: "volkswagen", model: "golf" });
  await catalog.listingTotal({ make: "volkswagen", model: "golf" });
  // Persisted: the plain listing's and the make's count and first page ids, and the plain listing's facets. (A make's
  // deeper pages stay in memory; these few rows cannot reach page 2.)
  await catalog.browseProducts({ make: "volkswagen" });
  await catalog.browseProducts({ sort: "newest", page: "1" });
  await catalog.catalogFacets({});
  const expected = [{ namespace: "count", n: 2 }, { namespace: "facets", n: 1 }, { namespace: "page-ids", n: 2 }];
  assert.deepEqual(await until(stored, rows => JSON.stringify(rows) === JSON.stringify(expected)), expected);
});

test("boundedQuery raises work_mem for its read only and refuses a malformed value", async () => {
  const { boundedQuery, db } = await import("../src/lib/db");
  assert.deepEqual((await boundedQuery<{ work_mem: string }>("test.workMem", "SELECT current_setting('work_mem') AS work_mem", [], 5_000, { workMem: "64MB" })).rows, [{ work_mem: "64MB" }]);
  assert.notEqual((await db.query<{ work_mem: string }>("SELECT current_setting('work_mem') AS work_mem")).rows[0].work_mem, "64MB");
  await assert.rejects(boundedQuery("test.badWorkMem", "SELECT 1", [], 5_000, { workMem: "64MB'; SELECT 1; --" }), /Invalid work_mem/);
});

test("boundedQuery logs a statement timeout with its label", async t => {
  const { boundedQuery } = await import("../src/lib/db");
  const logged = t.mock.method(console, "error", () => {});
  await assert.rejects(boundedQuery("test.sleep listing=x", "SELECT pg_sleep(2)", [], 50), { code: "57014" });
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /boundedQuery timeout: test\.sleep listing=x \(limit 50 ms/);
  await assert.rejects(boundedQuery("test.bad", "SELECT 1/0", []), { code: "22012" });
  assert.equal(logged.mock.callCount(), 1);
});

// Last: a missing table turns the persisted level off for five minutes in this process.
test("a missing cache table reads as a miss and does not throw", async () => {
  await schema.pool.query("DROP TABLE storefront_listing_cache");
  // The isolated search_path ends in public, so a dropped table would fall through to a shared public.storefront_listing_cache
  // (#1321). Take public off every connection the app pool can open: all of them exist and are pinned before the reads.
  const { db } = await import("../src/lib/db");
  const held = await Promise.all(Array.from({ length: db.options.max ?? 10 }, () => db.connect()));
  try {
    for (const client of held) await client.query(`SET search_path TO ${schema.name}`);
  } finally { for (const client of held) client.release(); }
  const counts = cacheStore.listingCacheStore<number>("test-count", 1);
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await counts.read("a"), null);
    await counts.write("a", 1, 9);
    assert.ok((await catalog.browseProducts({ sort: "newest", page: "2" })).total >= 0);
  } finally { console.error = originalError; }
});
