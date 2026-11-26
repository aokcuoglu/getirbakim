import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import { isolatedSchema } from "./isolated-schema";
import { failureHold, sharedLoads } from "../src/lib/ttl-cache";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

// One-scan listing summaries (#1367) in an isolated copy of the schema: a listing without a search, vehicle or narrowing
// filter loads its count, page-1 ids and facets from one statement (listingSummary), with the same values the separate
// statements give (LISTING_ONE_SCAN=0), one scan per cold page, a new scan after an epoch bump, and the three stored
// rows as before. The listing and search reads' server-side limit (#1377, LISTING_STATEMENT_TIMEOUT_MS) is checked with
// real statement timeouts: another session locks supplier_items in this schema while a read runs. So are the cancel of an
// aborted request's reads and the type-ahead's own limit (#1398, SUGGEST_STATEMENT_TIMEOUT_MS). Nothing is written to
// the shared database's tables.
type Catalog = typeof import("../src/modules/store/catalog");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: Catalog;
let invalidateListings: () => Promise<void>;
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();

// The category tree (getStoreCategories) calls connection(), which needs a request scope: a static work store lets it
// run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the other imports).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);

/** A Başbuğ row; `age` its changed_at in minutes before now (several rows may share one), `presence` inactive: unavailable. */
async function item(key: string, brand: string, age: number, { category = "", presence = "present" } = {}) {
  const product = { uk: brand, ac: `${key} PARCA`, ac2: "", dc: "TL", ...(category ? { category } : {}) };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,$4,now()-interval '30 days',$5,$5) RETURNING id::text`,
  [basbug, `${brand} ${key.toUpperCase()}9000`, product, presence, new Date(Date.UTC(2026, 10, 20) - age * 60_000)]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
/** Polls `read` until `done` holds or the deadline passes (the store writes without being awaited). */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(10);
  }
}
/** Every statement's text `run` sends, on any connection. */
async function sentTexts(run: () => Promise<unknown>) {
  const original = pg.Client.prototype.query;
  const texts: string[] = [];
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    texts.push(typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "");
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as typeof original;
  try {
    await run();
  } finally {
    pg.Client.prototype.query = original;
  }
  return texts;
}
/** The statements reading the catalog's rows (storefront_catalog_entries) that `run` sends, on any connection. */
async function scans(run: () => Promise<unknown>) {
  return (await sentTexts(run)).filter(text => text.includes("storefront_catalog_entries")).length;
}
/** Another app process: a second copy of the catalog module, with its own process caches, on the same database and epoch. */
const otherProcess = async (name: string) => await import(`../src/modules/store/catalog.ts?${name}`) as Catalog;
/** `run` with these environment variables set (undefined: unset), restored afterwards. */
async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const apply = (next: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return await run();
  } finally {
    apply(saved);
  }
}
/**
 * `run` with a 200 ms limit on the listing and search reads while another session holds `table` (supplier_items) in ACCESS EXCLUSIVE
 * mode: every read of the catalog's rows waits for the lock until its statement timeout (57014). Released afterwards, and
 * after 5 s at the latest, so an unbounded read fails the test's timing check instead of waiting for the lock for good.
 */
async function whileLocked<T>(run: () => Promise<T>, table = "supplier_items") {
  const locker = await schema.pool.connect();
  let release: ReturnType<typeof setTimeout> | undefined;
  try {
    await locker.query("BEGIN");
    await locker.query(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    release = setTimeout(() => void locker.query("ROLLBACK").catch(() => {}), 5_000);
    return await withEnv({ LISTING_STATEMENT_TIMEOUT_MS: "200" }, run);
  } finally {
    clearTimeout(release);
    await locker.query("ROLLBACK").catch(() => {});
    locker.release();
  }
}
/** `run`'s value or rejection, and how long it took to settle. */
async function timed<T>(run: () => Promise<T>) {
  const started = Date.now();
  try {
    return { value: await run(), ms: Date.now() - started };
  } catch (error) {
    return { error: error as { code?: string }, ms: Date.now() - started };
  }
}
/** What console.error was called with (its first argument), from a t.mock.method(console, "error") mock. */
const logLines = (logged: { mock: { calls: { arguments: unknown[] }[] } }) => logged.mock.calls.map(call => String(call.arguments[0]));
/** What a listing page shows of the three caches: the count, page 1's ids and the facets. */
const listing = (query: CatalogQuery) => inRequest(async () => ({
  total: await catalog.listingTotal(query),
  ids: (await catalog.browseProducts(query)).items.map(row => row.id),
  facets: await catalog.catalogFacets(query),
}));
/** `read` with LISTING_ONE_SCAN set to `value` (undefined: the default, one scan), after an epoch bump so the caches reload. */
async function withOneScan<T>(value: string | undefined, read: () => Promise<T>) {
  const saved = process.env.LISTING_ONE_SCAN;
  if (value === undefined) delete process.env.LISTING_ONE_SCAN;
  else process.env.LISTING_ONE_SCAN = value;
  try {
    await invalidateListings();
    return await read();
  } finally {
    if (saved === undefined) delete process.env.LISTING_ONE_SCAN;
    else process.env.LISTING_ONE_SCAN = saved;
  }
}

before(async () => {
  schema = await isolatedSchema("listing_summary_test");
  const brand = async (key: string) => (await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES($1,$1) RETURNING id::text", [key])).rows[0].id;
  const [bosch, mahle] = [await brand("BOSCH"), await brand("MAHLE")];
  await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES('basbug','BOSCH',$1,40),('basbug','MAHLE',$2,5)", [bosch, mahle]);
  // BOSCH lists 40 saleable rows and 2 unavailable ones (listed last): b1-b10 share the newest changed_at (their order is
  // the id tie-break), b11-b40 are older, one per minute. The hidden row and the secondary offer of b1 are not listed.
  for (let n = 1; n <= 40; n++) await item(`b${n}`, "BOSCH", n <= 10 ? 1 : n, { category: n >= 3 && n <= 8 ? "fren" : "" });
  for (const key of ["u1", "u2"]) await item(key, "BOSCH", 0, { presence: "inactive" });
  await item("hidden", "BOSCH", 0);
  await item("secondary", "BOSCH", 0);
  for (let n = 1; n <= 5; n++) await item(`m${n}`, "MAHLE", 100 + n, { category: n === 2 ? "fren" : "" });
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1) ON CONFLICT (item_id) DO UPDATE SET primary_id=EXCLUDED.primary_id", [ids.b1, ids.secondary]);
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$2,true)", [ids.hidden, await productOf("hidden")]);
  // VW fits b1-b5, u1 (unavailable) and m1-m3; its model Golf 7 fits b1, b2 and m1. DACIA fits nothing.
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW'),(3,'DACIA','DACIA');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF VII (5G1)','2012-08-01','2017-03-01')`);
  for (const key of ["b1", "b2", "b3", "b4", "b5", "u1", "m1", "m2", "m3"]) await schema.pool.query("INSERT INTO storefront_make_fits(brand_id,supplier_item_id) VALUES(1,$1)", [ids[key]]);
  for (const key of ["b1", "b2", "m1"]) await schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES(10,$1)", [ids[key]]);
  // Categories: 3 Yedek parçalar > 252 Fren (legacy "fren": b3-b8 and m2).
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
    ('trodo',3,NULL,'Yedek parçalar','yedek-parca','{3}','','{}'),('trodo',252,3,'Fren','fren','{3,252}','','{}');
    INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
    ('trodo',3,'tr','Yedek parçalar','yedek-parca'),('trodo',252,'tr','Fren','fren')`);
  // Facet rows, written by hand: their link to the shared enrichment links is dropped in this throwaway schema. Every facet
  // key has a value, so the 8-key limit and the key order apply; "Lamp Type" has 40 values on BOSCH (kept) and 41 on the
  // whole catalog (left out, over the 40-value limit).
  await schema.pool.query(`DO $$ DECLARE fk text; BEGIN
    FOR fk IN SELECT conname FROM pg_constraint WHERE conrelid='storefront_facet_specs'::regclass AND contype='f' LOOP
     EXECUTE format('ALTER TABLE storefront_facet_specs DROP CONSTRAINT %I',fk);
    END LOOP; END $$`);
  const facet = (key: string, name: string, value: string) => schema.pool.query("INSERT INTO storefront_facet_specs(supplier_item_id,key,value) VALUES($1,$2,$3)", [ids[key], name, value]);
  await facet("b1", "Fitting Position", "Front Axle");
  await facet("b2", "Fitting Position", "Rear Axle");
  await facet("b3", "Brand class", "Premium");
  await facet("m1", "Filter type", "Spin-on");
  for (const [index, name] of ["Bulb Type", "Fuel Type", "Shock Absorber Type", "Shock Absorber System", "Wiper blade type",
    "Oil Viscosity Classification SAE", "Transmission Type", "Mounting Type"].entries()) await facet(`b${index + 4}`, name, `${name} value`);
  for (let n = 1; n <= 40; n++) await facet(`b${n}`, "Lamp Type", `L${String(n).padStart(2, "0")}`);
  await facet("m1", "Lamp Type", "L41");
  // An admin's specifications (#603): b5's Fitting Position set, b1's hidden.
  await schema.pool.query("INSERT INTO product_override_specs(product_id,action,key,value) VALUES($1,'set','Fitting Position','Left')", [await productOf("b5")]);
  await schema.pool.query("INSERT INTO product_override_specs(product_id,action,key) VALUES($1,'hide','Fitting Position')", [await productOf("b1")]);
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, catalogModule, epoch] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"), import("../src/modules/store/listing-epoch")]);
  catalog = catalogModule;
  invalidateListings = epoch.invalidateListings;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("attributeFacetsSql is unchanged by the split it shares with the summary", () => {
  // Captured before #1367; the search path and plainSearch still read it.
  assert.equal(catalog.attributeFacetsSql("SELECT 1", "$2::text[]"), `WITH scoped AS MATERIALIZED (SELECT 1),
 ov AS MATERIALIZED (SELECT ps.supplier_item_id AS id,o.key,o.action,o.value FROM product_override_specs o JOIN product_sources ps ON ps.product_id=o.product_id WHERE o.key=ANY($2::text[])),
 fs AS MATERIALIZED (SELECT supplier_item_id,key,value FROM storefront_facet_specs WHERE key=ANY($2::text[])),
 specs AS (
  SELECT f.key,f.value FROM scoped JOIN fs f ON f.supplier_item_id=scoped.id
  WHERE NOT EXISTS (SELECT 1 FROM ov WHERE ov.id=scoped.id AND ov.key=f.key)
  UNION ALL
  SELECT ov.key,ov.value FROM ov JOIN scoped ON scoped.id=ov.id WHERE ov.action='set' AND length(ov.value)<=200)
 SELECT key,array_agg(DISTINCT value ORDER BY value) AS values FROM specs
 GROUP BY key HAVING count(DISTINCT value)<=40 ORDER BY CASE WHEN key='Fitting Position' THEN 0 WHEN key='Brand class' THEN 1 ELSE 2 END,key LIMIT 8`);
});

test("sharedLoads holds a load for holdMs after it settles, not after it starts; a failure is not held", async () => {
  let now = 0, loads = 0;
  const share = sharedLoads<number>(5_000, 2, () => now);
  let release = () => {};
  const gate = new Promise<void>(done => { release = done; });
  const first = share("k", async () => { await gate; return ++loads; });
  // Longer than the hold and still loading: a later caller shares the load.
  now = 6_000;
  const second = share("k", async () => ++loads);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  now = 10_999;
  assert.equal(await share("k", async () => ++loads), 1, "settled at 6 s: held until 11 s");
  now = 11_000;
  assert.equal(await share("k", async () => ++loads), 2);
  await assert.rejects(share("boom", async () => { throw new Error("database down"); }));
  assert.equal(await share("boom", async () => 7), 7, "a failed load is dropped");
});

test("the summary gives every covered listing the count, page-1 ids and facets of the separate statements", async () => {
  const listings: CatalogQuery[] = [{ manufacturer: "bosch" }, { make: "vw" }, { category: "fren" }, { make: "vw", category: "fren" },
    { make: "vw", model: "golf-7" }, {}, { make: "dacia" }];
  for (const query of listings) {
    const separate = await withOneScan("0", () => listing(query)), summarized = await withOneScan(undefined, () => listing(query));
    assert.deepEqual(summarized, separate, JSON.stringify(query));
  }
  // The values themselves, so the comparison is not between two empty answers.
  const bosch = await listing({ manufacturer: "bosch" });
  assert.equal(bosch.total, 42, "40 saleable and 2 unavailable rows; the hidden row and the secondary offer are not listed");
  const newest = Array.from({ length: 10 }, (_, index) => ids[`b${index + 1}`]).sort();
  assert.deepEqual(bosch.ids.slice(0, 10), newest, "the ten rows of one changed_at in id order");
  assert.deepEqual(bosch.ids.slice(10), Array.from({ length: 14 }, (_, index) => ids[`b${index + 11}`]));
  assert.deepEqual(bosch.facets.brands, ["BOSCH"]);
  assert.deepEqual(bosch.facets.attributes.map(facet => facet.key), ["Fitting Position", "Brand class", "Bulb Type", "Fuel Type", "Lamp Type",
    "Mounting Type", "Oil Viscosity Classification SAE", "Shock Absorber System"]);
  const values = (key: string) => bosch.facets.attributes.find(facet => facet.key === key)?.options.flatMap(option => option.values).sort();
  assert.equal(values("Lamp Type")?.length, 40);
  // b1's automatic value is hidden and b5's is set by the admin.
  assert.deepEqual(values("Fitting Position"), ["Left", "Rear Axle"]);
  const all = await listing({});
  assert.equal(all.total, 47);
  assert.deepEqual(all.facets.brands, ["BOSCH", "MAHLE"]);
  assert.ok(!all.facets.attributes.some(facet => facet.key === "Lamp Type"), "41 values: over the limit");
  assert.ok(all.facets.attributes.some(facet => facet.key === "Filter type"));
  const vw = await listing({ make: "vw" });
  assert.equal(vw.total, 9);
  assert.equal(vw.ids.at(-1), ids.u1, "the unavailable row last");
  assert.deepEqual(await listing({ make: "dacia" }), { total: 0, ids: [], facets: { brands: [], attributes: [] } });
});

test("a cold page reads its rows once: side by side, and a gated listing's count first", async () => {
  await schema.pool.query("TRUNCATE storefront_listing_cache");
  await invalidateListings();
  // The marka page: primeListing, then the total, then the view's listing and facets.
  const page = (query: CatalogQuery) => () => inRequest(async () => {
    catalog.primeListing(query);
    await catalog.listingTotal(query);
    await Promise.all([catalog.browseProducts(query), catalog.catalogFacets(query)]);
  });
  assert.equal(await scans(page({ manufacturer: "mahle" })), 1);
  assert.equal(await withOneScan("0", () => scans(page({ make: "vw", model: "golf-7" }))), 4, "count, page ids, brands and properties apart");
  // findListing awaits a gated listing's count before the page reads the rest.
  assert.equal(await scans(() => inRequest(async () => {
    await catalog.listingTotal({ make: "vw", category: "fren" });
    await Promise.all([catalog.browseProducts({ make: "vw", category: "fren" }), catalog.catalogFacets({ make: "vw", category: "fren" })]);
  })), 1);
});

test("an epoch bump reads the rows again and shows the edit", async () => {
  const query = { manufacturer: "bosch" };
  const before = await listing(query);
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$2,true)", [ids.b40, await productOf("b40")]);
  assert.equal(await scans(() => listing(query)), 0, "no bump: the cached values");
  await invalidateListings();
  let after: Awaited<ReturnType<typeof listing>> | undefined;
  assert.equal(await scans(async () => { after = await listing(query); }), 1);
  assert.equal(after?.total, before.total - 1);
});

test("a filtered listing keeps its own count and ids; its facets are its scope's summary", async () => {
  const filtered = { manufacturer: "bosch", brands: JSON.stringify(["BOSCH"]) };
  const separate = await withOneScan("0", () => listing(filtered)), summarized = await withOneScan(undefined, () => listing(filtered));
  assert.deepEqual(summarized, separate);
  assert.deepEqual(summarized.facets, (await listing({ manufacturer: "bosch" })).facets);
  assert.equal(summarized.total, 41);
});

test("a summarized listing stores one count, page-ids and facets row; a make listing read through browseProducts no facets", async () => {
  const stored = async () => (await schema.pool.query<{ namespace: string; n: number }>(
    "SELECT namespace,count(*)::int AS n FROM storefront_listing_cache GROUP BY namespace ORDER BY namespace")).rows;
  await schema.pool.query("TRUNCATE storefront_listing_cache");
  await invalidateListings();
  await inRequest(async () => {
    catalog.primeListing({ manufacturer: "bosch" });
    await listing({ manufacturer: "bosch" });
  });
  const expected = [{ namespace: "count", n: 1 }, { namespace: "facets", n: 1 }, { namespace: "page-ids", n: 1 }];
  assert.deepEqual(await until(stored, rows => JSON.stringify(rows) === JSON.stringify(expected)), expected);
  await schema.pool.query("TRUNCATE storefront_listing_cache");
  await invalidateListings();
  await inRequest(() => catalog.browseProducts({ make: "vw" }));
  const make = [{ namespace: "count", n: 1 }, { namespace: "page-ids", n: 1 }];
  assert.deepEqual(await until(stored, rows => JSON.stringify(rows) === JSON.stringify(make)), make);
  // Nothing else arrives later.
  await sleep(50);
  assert.deepEqual(await stored(), make);
});

test("boundedQuery stops a read on the server at its limit: 57014, nothing left running, the pool still answers (#1377)", async t => {
  const { boundedQuery, db } = await import("../src/lib/db");
  const logged = t.mock.method(console, "error", () => {});
  const { error, ms } = await timed(() => boundedQuery("test.sleep", "SELECT pg_sleep(5)", [], 200));
  assert.equal(error?.code, "57014");
  assert.ok(ms < 2_000, `${ms} ms`);
  assert.match(logLines(logged)[0] ?? "", /^boundedQuery timeout: test\.sleep \(limit 200 ms, \d+ ms\)$/);
  const running = await schema.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE state='active' AND query='SELECT pg_sleep(5)'");
  assert.equal(running.rows[0].n, 0, "the statement was cancelled on the server");
  // The pool's sessions are named (fallback_application_name) unless PGAPPNAME or the URL names them.
  const expected = process.env.PGAPPNAME || new URL(process.env.DATABASE_URL!).searchParams.get("application_name") || "getirbakim-web";
  assert.deepEqual((await db.query("SELECT current_setting('application_name') AS name")).rows, [{ name: expected }]);
});

test("boundedQuery logs a read that succeeds after BOUNDED_QUERY_SLOW_MS once; a fast read, a timeout, the 20 s default and 0 log none (#1377)", async t => {
  const { boundedQuery } = await import("../src/lib/db");
  const warned = t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  await withEnv({ BOUNDED_QUERY_SLOW_MS: "100" }, async () => {
    assert.equal((await boundedQuery("test.slow", "SELECT pg_sleep(0.2)", [], 5_000)).rowCount, 1);
    await boundedQuery("test.fast", "SELECT 1", [], 5_000);
    await assert.rejects(boundedQuery("test.timeout", "SELECT pg_sleep(1)", [], 150), { code: "57014" });
  });
  await withEnv({ BOUNDED_QUERY_SLOW_MS: undefined }, () => boundedQuery("test.default", "SELECT pg_sleep(0.2)", [], 5_000));
  await withEnv({ BOUNDED_QUERY_SLOW_MS: "0" }, () => boundedQuery("test.off", "SELECT pg_sleep(0.2)", [], 5_000));
  const lines = logLines(warned);
  assert.equal(lines.length, 1, lines.join("\n"));
  const [, ms] = /^boundedQuery slow: test\.slow \((\d+) ms, limit 5000 ms\)$/.exec(lines[0]) ?? [];
  assert.ok(Number(ms) >= 200, lines[0]);
});

test("a listing reload that times out serves the earlier count and facets; the next read after the lock reloads (#1377)", async t => {
  const query = { manufacturer: "bosch" };
  const read = () => inRequest(async () => ({ total: await catalog.listingTotal(query), facets: await catalog.catalogFacets(query) }));
  const earlier = await read();
  assert.ok(earlier.total > 0 && earlier.facets.brands.length > 0);
  const logged = t.mock.method(console, "error", () => {});
  await invalidateListings();
  // Only the reads of the catalog's rows wait on the lock; the epoch, the manufacturer directory and the brand labels do not.
  const locked = await whileLocked(() => timed(read));
  assert.deepEqual(locked.value, earlier, "the earlier values");
  // The bounded wait (LISTING_EPOCH_WAIT_MS, 30 s in these tests) would serve them too, but only after 30 s.
  assert.ok(locked.ms < 2_000, `${locked.ms} ms`);
  assert.ok(logLines(logged).some(line => line.startsWith("boundedQuery timeout: catalog.listingSummary [")), logLines(logged).join("\n"));
  assert.equal(await scans(read), 1, "the next read reloads, the count and facets from one scan");
  assert.deepEqual(await read(), earlier);
});

test("another process serves the stored count when its load times out after a bump (#1377)", async t => {
  const query = { manufacturer: "bosch" };
  await schema.pool.query("TRUNCATE storefront_listing_cache");
  await invalidateListings();
  const total = await inRequest(() => catalog.listingTotal(query));
  const storedCounts = async () => (await schema.pool.query<{ value: number }>("SELECT value FROM storefront_listing_cache WHERE namespace='count'")).rows.map(row => row.value);
  assert.deepEqual(await until(storedCounts, values => values.length === 1), [total]);
  await invalidateListings();
  const other = await otherProcess("timeout");
  const logged = t.mock.method(console, "error", () => {});
  const locked = await whileLocked(() => timed(() => inRequest(() => other.listingTotal(query))));
  assert.equal(locked.value, total, "the stored count of the earlier epoch");
  assert.ok(locked.ms < 2_000, `${locked.ms} ms`);
  assert.ok(logLines(logged).includes("Stale cache load failed; serving the stored value"), logLines(logged).join("\n"));
  assert.equal(await inRequest(() => other.listingTotal(query)), total, "loaded after the lock");
});

test("a cold listing whose read times out fails within the limit instead of hanging, and loads after the lock (#1377)", async t => {
  t.mock.method(console, "error", () => {});
  // Never read before, and not stored (brands): no earlier value to serve.
  const query = { manufacturer: "mahle", brands: JSON.stringify(["MAHLE"]) };
  const locked = await whileLocked(() => timed(() => inRequest(() => catalog.listingTotal(query))));
  assert.equal(locked.error?.code, "57014");
  assert.ok(locked.ms < 2_000, `${locked.ms} ms`);
  assert.equal(await inRequest(() => catalog.listingTotal(query)), 5, "the failed load was not cached");
});

test("a search whose hit read times out fails within the limit, and answers after the lock (#1377)", async t => {
  t.mock.method(console, "error", () => {});
  const search = () => inRequest(() => catalog.browseProducts({ q: "parca" }));
  const locked = await whileLocked(() => timed(search));
  assert.equal(locked.error?.code, "57014");
  assert.ok(locked.ms < 2_000, `${locked.ms} ms`);
  assert.ok((await search()).total > 0);
});

test("LISTING_STATEMENT_TIMEOUT_MS=0 sends the reads as plain statements; by default they carry 55 s, an out-of-stock read keeps 30 s (#1377)", async () => {
  const limits = async (from: Catalog, query: CatalogQuery, setting: string | undefined, scopeMax?: string) => [...new Set((await sentTexts(() =>
    withEnv({ LISTING_STATEMENT_TIMEOUT_MS: setting, LISTING_STOCK_SCOPE_MAX_IDS: scopeMax }, () => inRequest(() => from.listingTotal(query)))))
    .filter(text => text.includes("statement_timeout")))];
  const filtered = { manufacturer: "mahle", brands: JSON.stringify(["MAHLE"]) }, outOfStock = { manufacturer: "mahle", availability: "out_of_stock" as const };
  // Other processes: the count and the brand labels are read cold.
  const off = await otherProcess("off"), on = await otherProcess("on");
  assert.deepEqual(await limits(off, filtered, "0"), []);
  assert.deepEqual(await limits(on, filtered, undefined), ["SET LOCAL statement_timeout = 55000"]);
  // Out of stock over the whole stock set (LISTING_STOCK_SCOPE_MAX_IDS=0) runs at its own work_mem and 30 s whatever the setting.
  assert.deepEqual(await limits(off, outOfStock, "0", "0"), ["SET LOCAL statement_timeout = 30000"]);
  assert.deepEqual(await limits(on, outOfStock, undefined, "0"), ["SET LOCAL statement_timeout = 30000"]);
  // Scoped by the manufacturer's listed ids (#1455), it needs no extra work_mem and runs under the listing's limit, as its
  // scope read does. Fresh processes: the scope is read cold.
  assert.deepEqual(await limits(await otherProcess("scoped-off"), outOfStock, "0"), []);
  assert.deepEqual(await limits(await otherProcess("scoped-on"), outOfStock, undefined), ["SET LOCAL statement_timeout = 55000"]);
});

/** Lock requests waiting on this schema's supplier_items: reads whileLocked holds up, until they get it or are cancelled. */
const blockedReads = async () => (await schema.pool.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM pg_locks WHERE relation='supplier_items'::regclass AND NOT granted")).rows[0].n;
/** Sessions running exactly `text` now. */
const running = async (text: string) => (await schema.pool.query<{ n: number }>(
  "SELECT count(*)::int AS n FROM pg_stat_activity WHERE state='active' AND query=$1", [text])).rows[0].n;
/** A type-ahead call's value or rejection and its time (`signal`: the request's). */
const suggest = (q: string, signal?: AbortSignal) => timed(() => catalog.suggestProducts(q, "all", 6, { signal }));

test("boundedQuery cancels a running read when its signal aborts: the signal's reason within 1 s, nothing left running, the connection reused (#1398)", async t => {
  const { boundedQuery, db } = await import("../src/lib/db");
  const warned = t.mock.method(console, "warn", () => {});
  const logged = t.mock.method(console, "error", () => {});
  await db.query("SELECT 1");
  const connections = db.totalCount;
  // Named after the schema, so a parallel run of this file is not counted.
  const sleepSql = `SELECT pg_sleep(5) AS ${schema.name}`;
  const controller = new AbortController(), reason = new Error("visitor left");
  const read = timed(() => boundedQuery("test.abort", sleepSql, [], 10_000, { signal: controller.signal }));
  assert.equal(await until(() => running(sleepSql), n => n === 1), 1, "running on the server");
  await sleep(100);
  const aborted = Date.now();
  controller.abort(reason);
  const { error } = await read;
  const ms = Date.now() - aborted;
  assert.equal(error, reason, "rejects with the signal's reason");
  assert.ok(ms < 1_000, `${ms} ms`);
  assert.equal(await until(() => running(sleepSql), n => n === 0, 1_000), 0, "cancelled on the server, long before its 10 s limit");
  const lines = logLines(warned).filter(line => line.startsWith("boundedQuery "));
  assert.equal(lines.length, 1, lines.join("\n"));
  assert.match(lines[0], /^boundedQuery cancelled: test\.abort \(\d+ ms\)$/);
  assert.ok(!logLines(logged).some(line => line.startsWith("boundedQuery timeout")), logLines(logged).join("\n"));
  // The cancelled connection went back idle, its transaction rolled back: the next reads take it again.
  for (let n = 0; n < 20; n++) assert.deepEqual((await boundedQuery("test.after", "SELECT 1 AS n", [], 5_000)).rows, [{ n: 1 }]);
  assert.ok(db.totalCount <= connections, `${db.totalCount} connections, ${connections} before: the cancel used its own`);
});

test("boundedQuery sends nothing for an aborted signal, refuses a signal on a write, and sends its statements unchanged without one (#1398)", async () => {
  const { boundedQuery } = await import("../src/lib/db");
  const controller = new AbortController(), reason = new Error("gone");
  controller.abort(reason);
  assert.deepEqual(await sentTexts(() => assert.rejects(boundedQuery("test.aborted", "SELECT 1", [], 5_000, { signal: controller.signal }), error => error === reason)), []);
  await assert.rejects(boundedQuery("test.write", "SELECT 1", [], 5_000, { write: true, signal: new AbortController().signal }), /only a read/);
  assert.deepEqual(await sentTexts(() => boundedQuery("test.plain", "SELECT 1", [], 1_234)), ["BEGIN READ ONLY", "SET LOCAL statement_timeout = 1234", "SELECT 1", "COMMIT"]);
  assert.deepEqual(await sentTexts(() => boundedQuery("test.workMem", "SELECT 1", [], 1_234, { workMem: "8MB" })),
    ["BEGIN READ ONLY", "SET LOCAL statement_timeout = 1234", "SET LOCAL work_mem = '8MB'", "SELECT 1", "COMMIT"]);
  // With a signal, the limit, the backend's pid and its start in one round trip.
  const [begin, limit, ...rest] = await sentTexts(() => boundedQuery("test.signal", "SELECT 1", [], 1_234, { signal: new AbortController().signal }));
  assert.equal(begin, "BEGIN READ ONLY");
  assert.match(limit, /^SELECT set_config\('statement_timeout',\$1,true\), pg_backend_pid\(\) AS pid,\s+\(SELECT [\s\S]*backend_start[\s\S]* AS since$/);
  assert.deepEqual(rest, ["SELECT 1", "COMMIT"]);
});

test("an abort before the statement is sent sends no statement and gives the client back: while waiting for the pool, during the limit's round trip (#1398)", async () => {
  const { boundedQuery, db } = await import("../src/lib/db");
  const checkedOut = async () => db.totalCount - db.idleCount;
  const reason = new Error("gone");
  // Aborted after the call, while the pool hands over a client.
  const waiting = new AbortController();
  assert.deepEqual(await sentTexts(async () => {
    const read = boundedQuery("test.poolAbort", "SELECT 1", [], 5_000, { signal: waiting.signal });
    waiting.abort(reason);
    await assert.rejects(read, error => error === reason);
  }), []);
  assert.equal(await until(checkedOut, n => n === 0), 0, "the client went back");
  // Aborted while the limit is being set: after connect, before the listener.
  const between = new AbortController();
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    if ((typeof config === "string" ? config : "").includes("set_config")) between.abort(reason);
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as typeof original;
  let texts: string[];
  try {
    texts = await sentTexts(() => assert.rejects(boundedQuery("test.limitAbort", "SELECT 1", [], 5_000, { signal: between.signal }), error => error === reason));
  } finally {
    pg.Client.prototype.query = original;
  }
  assert.equal(texts.length, 3, texts.join("\n"));
  assert.equal(texts[0], "BEGIN READ ONLY");
  assert.match(texts[1], /^SELECT set_config/);
  assert.equal(texts[2], "ROLLBACK", "rolled back without the statement");
  assert.equal(await until(checkedOut, n => n === 0), 0, "the client went back");
  assert.deepEqual((await boundedQuery("test.afterAbort", "SELECT 1 AS n", [], 5_000)).rows, [{ n: 1 }]);
});

test("cancelBackend stops a statement only on the backend that started at `since`: a reused pid is left alone (#1398)", async () => {
  const { cancelBackend } = await import("../src/lib/db");
  const session = await schema.pool.connect();
  try {
    const { pid, since } = (await session.query<{ pid: number; since: string }>(
      "SELECT pid,(extract(epoch FROM backend_start)*1000000)::bigint AS since FROM pg_stat_activity WHERE pid=pg_backend_pid()")).rows[0];
    const sleepSql = `SELECT pg_sleep(3) AS ${schema.name}_since`;
    const read = timed(() => session.query(sleepSql));
    assert.equal(await until(() => running(sleepSql), n => n === 1), 1, "running");
    await cancelBackend(pid, String(BigInt(since) - BigInt(1)));
    await sleep(200);
    assert.equal(await running(sleepSql), 1, "another start: not cancelled");
    await cancelBackend(pid, since);
    const { error, ms } = await read;
    assert.equal(error?.code, "57014");
    assert.ok(ms < 1_500, `${ms} ms`);
  } finally {
    session.release();
  }
});

test("an abort after the read has settled cancels nothing: the next read answers, no cancelled line (#1398)", async t => {
  const { boundedQuery } = await import("../src/lib/db");
  const warned = t.mock.method(console, "warn", () => {});
  const controller = new AbortController();
  assert.deepEqual((await boundedQuery("test.settled", "SELECT 1 AS n", [], 5_000, { signal: controller.signal })).rows, [{ n: 1 }]);
  const texts = await sentTexts(async () => {
    controller.abort(new Error("late"));
    await sleep(50);
    assert.deepEqual((await boundedQuery("test.next", "SELECT 2 AS n", [], 5_000)).rows, [{ n: 2 }]);
  });
  assert.ok(!texts.some(text => text.includes("pg_cancel_backend")), texts.join("\n"));
  assert.ok(!logLines(warned).some(line => line.startsWith("boundedQuery cancelled")), logLines(warned).join("\n"));
});

test("an aborted type-ahead request leaves the hit-set load it shares running: the other request gets its answer (#1398)", async t => {
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  const controller = new AbortController(), reason = new Error("typed on");
  let calls: ReturnType<typeof suggest>[] = [];
  const texts = await sentTexts(async () => {
    await withEnv({ SUGGEST_STATEMENT_TIMEOUT_MS: undefined }, () => whileLocked(async () => {
      // One cold key: both share its hit read, which waits for the lock.
      calls = [suggest("parca", controller.signal), suggest("parca")];
      assert.ok(await until(blockedReads, n => n >= 1) >= 1, "the shared hit read waits for the lock");
      controller.abort(reason);
      await sleep(300);
      assert.ok(await blockedReads() >= 1, "still waiting: the abort did not cancel it");
    }));
    await Promise.all(calls);
  });
  const [left, stayed] = await Promise.all(calls);
  assert.ok(!texts.some(text => text.includes("pg_cancel_backend")), "no cancel was sent");
  assert.ok((stayed.value?.products.length ?? 0) > 0, JSON.stringify(stayed));
  assert.equal(left.error, reason, "the aborted request's own live read is not sent");
});

test("an aborted type-ahead request cancels its live read on the server within 1 s (#1398)", async t => {
  const warned = t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  // The hit set from the cache: only the live product read waits for the lock.
  assert.ok((await catalog.suggestProducts("parca", "all")).products.length > 0);
  const controller = new AbortController(), reason = new Error("typed on");
  const cancelled = await withEnv({ SUGGEST_STATEMENT_TIMEOUT_MS: undefined }, () => whileLocked(async () => {
    const read = suggest("parca", controller.signal);
    assert.ok(await until(blockedReads, n => n >= 1) >= 1, "the live read waits for the lock");
    const aborted = Date.now();
    controller.abort(reason);
    const { error } = await read;
    return { error, ms: Date.now() - aborted, left: await until(blockedReads, n => n === 0, 1_000) };
  }));
  assert.equal(cancelled.error, reason);
  assert.ok(cancelled.ms < 1_000, `${cancelled.ms} ms`);
  assert.equal(cancelled.left, 0, "the statement is gone while the lock is still held");
  assert.ok(logLines(warned).some(line => /^boundedQuery cancelled: catalog\.suggestProducts \(\d+ ms\)$/.test(line)), logLines(warned).join("\n"));
});

test("the type-ahead's reads stop at SUGGEST_STATEMENT_TIMEOUT_MS while listing reads keep 55 s; 0 gives the listing limit (#1398)", async t => {
  t.mock.method(console, "error", () => {});
  // The listing limit unset (55 s) under the lock: only the type-ahead's own limit can stop the read before the release.
  const locked = await whileLocked(() => withEnv({ LISTING_STATEMENT_TIMEOUT_MS: undefined, SUGGEST_STATEMENT_TIMEOUT_MS: "200", SEARCH_FAILURE_HOLD_MS: "0" }, () => suggest("mahle")));
  assert.equal(locked.error?.code, "57014");
  assert.ok(locked.ms < 1_500, `${locked.ms} ms`);
  const limits = async (run: () => Promise<unknown>, env: Record<string, string | undefined>) =>
    [...new Set((await sentTexts(() => withEnv(env, run))).filter(text => text.includes("statement_timeout")))];
  // Cold keys: the shared hit-set load and the live reads both go out.
  assert.deepEqual(await limits(() => catalog.suggestProducts("bosch", "all"), { SUGGEST_STATEMENT_TIMEOUT_MS: "1500", LISTING_STATEMENT_TIMEOUT_MS: undefined }),
    ["SET LOCAL statement_timeout = 1500"]);
  const other = await otherProcess("suggest-limit");
  assert.deepEqual(await limits(() => inRequest(() => other.listingTotal({ manufacturer: "mahle", brands: JSON.stringify(["MAHLE"]) })),
    { SUGGEST_STATEMENT_TIMEOUT_MS: "1500", LISTING_STATEMENT_TIMEOUT_MS: undefined }), ["SET LOCAL statement_timeout = 55000"]);
  assert.deepEqual(await limits(() => catalog.suggestProducts("mahle", "all"), { SUGGEST_STATEMENT_TIMEOUT_MS: "0", LISTING_STATEMENT_TIMEOUT_MS: "40000" }),
    ["SET LOCAL statement_timeout = 40000"]);
  assert.deepEqual(await limits(() => catalog.suggestProducts("parc", "all"), { SUGGEST_STATEMENT_TIMEOUT_MS: "0", LISTING_STATEMENT_TIMEOUT_MS: "0" }), [],
    "both off: plain statements");
  // A cold zero-hit search also reads the spell-correction: under the type-ahead's limit alone, never the listing's (#1416).
  assert.deepEqual(await limits(() => catalog.suggestProducts("zzzqxa", "all"), { SUGGEST_STATEMENT_TIMEOUT_MS: "1500", LISTING_STATEMENT_TIMEOUT_MS: undefined }),
    ["SET LOCAL statement_timeout = 1500"]);
  // A two-word zero-hit search reads the vehicle reading and resolvePart's corrections too: the type-ahead's limit only.
  assert.deepEqual(await limits(() => catalog.suggestProducts("zzzqxc zzzqxd", "all"), { SUGGEST_STATEMENT_TIMEOUT_MS: "1500", LISTING_STATEMENT_TIMEOUT_MS: undefined }),
    ["SET LOCAL statement_timeout = 1500"]);
  assert.deepEqual(await limits(() => catalog.suggestProducts("zzzqxb", "all"), { SUGGEST_STATEMENT_TIMEOUT_MS: "0", LISTING_STATEMENT_TIMEOUT_MS: "0" }), [],
    "both off: the correction is a plain statement too");
});

test("failureHold keeps a failure for holdMs, drops it after, holds nothing at 0 and evicts the oldest past maxEntries (#1416)", () => {
  let hold = 100, clock = 1_000;
  const held = failureHold(() => hold, 2, () => clock), boom = new Error("boom");
  held.hold("a", boom);
  assert.equal(held.failure("a")?.error, boom);
  assert.equal(held.failure("b"), undefined);
  clock += 99;
  assert.equal(held.failure("a")?.error, boom);
  clock += 1;
  assert.equal(held.failure("a"), undefined, "expired at holdMs");
  hold = 0;
  held.hold("c", boom);
  assert.equal(held.failure("c"), undefined, "0 holds nothing");
  hold = 100;
  held.hold("d", boom); held.hold("e", boom); held.hold("f", boom);
  assert.equal(held.failure("d"), undefined, "the oldest left");
  assert.equal(held.failure("e")?.error, boom);
  assert.equal(held.failure("f")?.error, boom);
});

/** The hit-set statements (searchHitIdsSql) among the statements `run` sends. */
const hitReads = async (run: () => Promise<unknown>) => (await sentTexts(run)).filter(text => text.includes("WITH main AS MATERIALIZED")).length;
const holdEnv = { SUGGEST_STATEMENT_TIMEOUT_MS: "200", SEARCH_FAILURE_HOLD_MS: "400" };

test("a type-ahead key whose hit read timed out is held: the same error at once, no statement; other keys load; it loads after the hold (#1416)", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  const first = await withEnv(holdEnv, () => whileLocked(() => suggest("bosc")));
  assert.equal(first.error?.code, "57014");
  assert.ok(first.ms < 1_500, `${first.ms} ms`);
  let held: Awaited<ReturnType<typeof suggest>> | undefined;
  const reads = await hitReads(async () => { held = await withEnv(holdEnv, () => suggest("bosc")); });
  assert.equal(held?.error?.code, "57014", "the held failure is the original error");
  assert.ok(held.ms < 100, `${held.ms} ms`);
  assert.equal(reads, 0, "no hit statement");
  const other = await withEnv(holdEnv, () => suggest("mahl"));
  assert.ok((other.value?.products.length ?? 0) > 0, JSON.stringify(other));
  await sleep(450);
  const after = await withEnv(holdEnv, () => suggest("bosc"));
  assert.ok((after.value?.products.length ?? 0) > 0, JSON.stringify(after));
});

test("a held key with an earlier value serves it without a hit statement; after the hold the read is sent again (#1416)", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  assert.ok(((await withEnv(holdEnv, () => suggest("mahle"))).value?.products.length ?? 0) > 0);
  await invalidateListings();
  await withEnv(holdEnv, () => whileLocked(() => suggest("mahle")));
  await until(blockedReads, n => n === 0, 1_000);
  let within: Awaited<ReturnType<typeof suggest>> | undefined;
  const reads = await hitReads(async () => { within = await withEnv(holdEnv, () => suggest("mahle")); });
  assert.ok((within?.value?.products.length ?? 0) > 0, JSON.stringify(within));
  assert.equal(reads, 0, "no hit statement within the hold");
  await sleep(450);
  assert.ok(await hitReads(() => withEnv(holdEnv, () => suggest("mahle"))) >= 1, "the hit read goes out again after the hold");
});

test("SEARCH_FAILURE_HOLD_MS=0 holds nothing: the next call reads again (#1416)", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  const env = { SUGGEST_STATEMENT_TIMEOUT_MS: "200", SEARCH_FAILURE_HOLD_MS: "0" };
  assert.equal((await withEnv(env, () => whileLocked(() => suggest("mahlb")))).error?.code, "57014");
  const second = await hitReads(() => withEnv(env, () => suggest("mahlb")));
  assert.ok(second >= 1, "the hit read goes out again");
});

test("a spell-correction that times out answers as typed, pauses its scope, and works again after the hold (#1416)", async t => {
  const logged = t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  await schema.pool.query("SELECT refresh_search_vocabulary()");
  const env = { ...holdEnv, LISTING_STATEMENT_TIMEOUT_MS: undefined };
  const failed = await withEnv(env, () => whileLocked(() => suggest("mahlee"), "search_vocabulary"));
  assert.ok(failed.ms < 1_500, `${failed.ms} ms`);
  assert.deepEqual(failed.value?.products, [], JSON.stringify(failed));
  assert.equal(failed.value?.correctedQuery, undefined);
  assert.ok(logLines(logged).some(line => line.startsWith("Search correction failed")), logLines(logged).join("\n"));
  const texts = await sentTexts(() => withEnv(env, () => suggest("mahlea")));
  assert.ok(!texts.some(text => text.includes("search_vocabulary")), "the paused scope sends no statement");
  await sleep(450);
  const fixed = await withEnv(env, () => suggest("mahlle"));
  assert.equal(fixed.value?.correctedQuery, "mahle", JSON.stringify(fixed));
  // The listing path: a failed correction renders an empty result instead of throwing.
  await sleep(450);
  const page = await withEnv({ SEARCH_FAILURE_HOLD_MS: "400" }, () => whileLocked(() => timed(() => inRequest(() => catalog.browseProducts({ q: "mahleee" }))), "search_vocabulary"));
  assert.equal(page.error, undefined, JSON.stringify(page.error));
  assert.equal(page.value?.total, 0);
});

test("the suggest route answers a timeout 503 with Retry-After and no-store, any other error 500 (#1416)", async t => {
  const warned = t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  const { GET } = await import("../src/app/api/search/suggest/route");
  const call = (q: string) => inRequest(() => GET(new Request(`http://localhost/api/search/suggest?q=${q}`)));
  const timedOut = await withEnv(holdEnv, () => whileLocked(() => call("boscb")));
  assert.equal(timedOut.status, 503);
  assert.equal(timedOut.headers.get("Retry-After"), "30");
  assert.equal(timedOut.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await timedOut.json(), { error: "Öneriler şu anda yüklenemiyor." });
  assert.ok(logLines(warned).includes("Search suggestions timed out"), logLines(warned).join("\n"));
  const heldAgain = await withEnv(holdEnv, () => call("boscb"));
  assert.equal(heldAgain.status, 503, "a held key");
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    if ((typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "").includes("WITH main AS MATERIALIZED")) return Promise.reject(new Error("boom"));
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as typeof original;
  try {
    assert.equal((await withEnv(holdEnv, () => call("boscc"))).status, 500);
  } finally {
    pg.Client.prototype.query = original;
  }
});
