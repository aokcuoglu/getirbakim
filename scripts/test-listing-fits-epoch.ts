import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { StaleCacheStore } from "../src/lib/stale-cache";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

// The fits epoch (#1368) in an isolated copy of the schema: the fit sync's bump (invalidateFits) moves only the value the
// caches that read vehicle fits follow (epoch+fits_epoch), an admin edit's (invalidateListings) moves both, and the
// guarded column is added once, continuing the scale of the stored rows. The fit sync's bump reloads the make listing,
// its listed models and category counts and the searches that may name a vehicle, leaves the manufacturer and category
// listings cached, and the fit caches a page reads itself wait at most LISTING_EPOCH_WAIT_MS for their reload. Nothing
// is written to the shared database.
type Epoch = typeof import("../src/modules/store/listing-epoch");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let epoch: Epoch;
let catalog: typeof import("../src/modules/store/catalog");
let categories: typeof import("../src/modules/store/listing-categories.server");
let closeDb: () => Promise<void>;
const [basbug] = storefrontCompanies();
/** BOSCH rows: all in Filtre, all fitting VW and its Golf 7; Polo 6 and Tiguan 2 have no fit yet; 1001 and 1002 fit the garage's Golf. */
const rows = 30, GOLF = 340;
let added = 0;

// The category tree (getStoreCategories) calls connection(), which needs a request scope: a static work store lets it
// run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the other imports).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);
const manufacturer: CatalogQuery = { manufacturer: "bosch" }, category: CatalogQuery = { category: "filtre" }, make: CatalogQuery = { make: "vw" };
const total = (query: CatalogQuery) => inRequest(() => catalog.listingTotal(query));
const listedModels = async () => (await catalog.getListedModelGroups("1")).map(group => group.slug).sort();
const filterCount = async () => (await inRequest(() => categories.scopeCategoryCounts({ make: "vw" }))).get(241);
/** A new BOSCH row in Filtre fitting VW and (`model`) one of its models: what the fit sync and an import change. */
async function addFittedRow(model: number) {
  added++;
  const { rows: [row] } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,jsonb_build_object('uk','BOSCH','ac',$2::text||' PARCA','ac2','','dc','TL','category','filtre'),'{"nf":100}','{"stok":2}',
     1,1,1,'present',now(),now(),now()) RETURNING id::text`, [basbug, `BOSCH ${9000 + added}`]);
  await schema.pool.query("INSERT INTO storefront_make_fits(brand_id,supplier_item_id) VALUES(1,$1)", [row.id]);
  await schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES($1,$2)", [model, row.id]);
}
/** An admin's added fitment (#583) of the product of supplier code `code` to the garage's Golf: a fit the store lists. */
const addVehicleFit = (code: string) => schema.pool.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode)
  SELECT ps.product_id,$2,'add' FROM product_sources ps JOIN supplier_items s ON s.id=ps.supplier_item_id WHERE s.code=$1`, [code, GOLF]);
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
/** Polls `read` until `done` holds or the deadline passes (loads finish in the background). */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await sleep(10);
  }
}
/**
 * The loads `run` sends on any connection: by default listing loads (the one-scan summary or a count statement over the
 * catalog), else the statements `matches` names; `other`, every statement but those and the epoch reads.
 */
async function loads(run: () => Promise<unknown>, matches = (text: string) => text.includes("storefront_catalog_entries")) {
  const original = pg.Client.prototype.query;
  let sent = 0, other = 0;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "";
    if (matches(text)) sent++;
    else if (!text.includes("storefront_listing_epoch")) other++;
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as typeof original;
  try {
    await run();
  } finally {
    pg.Client.prototype.query = original;
  }
  return { loads: sent, other };
}

/** The row as another process reads it: `epoch` and the fits value. */
const counters = async () => (await schema.pool.query<{ epoch: number; fits_epoch: number; fits: number }>(
  "SELECT epoch::int,fits_epoch::int,(epoch+fits_epoch)::int AS fits FROM storefront_listing_epoch")).rows[0];
const column = async () => (await schema.pool.query<{ attnum: number; notnull: boolean; fallback: string }>(
  `SELECT a.attnum,a.attnotnull AS notnull,pg_get_expr(d.adbin,d.adrelid) AS fallback FROM pg_attribute a
   LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid='storefront_listing_epoch'::regclass AND a.attname='fits_epoch' AND NOT a.attisdropped`)).rows[0];
const applyOverrides = async () => schema.pool.query(await readFile("db/product-overrides.sql", "utf8"));
/** Another app process: a second copy of the module, with its own known values, on the same database. */
const otherProcess = async (name: string) => await import(`../src/modules/store/listing-epoch.ts?${name}`) as Epoch;

before(async () => {
  schema = await isolatedSchema("listing_fits_epoch_test");
  const { rows: [brand] } = await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES('BOSCH','BOSCH') RETURNING id::text");
  await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES('basbug','BOSCH',$1,$2)", [brand.id, rows]);
  await schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    SELECT 'basbug',$1,'G','MRK','BOSCH '||(1000+n),jsonb_build_object('uk','BOSCH','ac','P'||n||' PARCA','ac2','','dc','TL','category','filtre'),
     '{"nf":100}','{"stok":2}',1,1,1,'present',now()-interval '30 days',now(),now() FROM generate_series(1,$2::int) n`, [basbug, rows]);
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF VII (5G1)','2012-08-01','2017-03-01'),(20,1,'POLO VI (AW1)','2017-06-01',NULL),
     (30,1,'TIGUAN II (AD1)','2016-01-01',NULL);
    INSERT INTO vehicle_brands(id,name,display_name) VALUES(2,'AUDI','AUDI');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(40,2,'A3 (8V1)','2012-01-01',NULL),(50,2,'A4 (8W2)','2015-01-01',NULL);
    INSERT INTO vehicle_brands(id,name,display_name) VALUES(3,'SEAT','SEAT');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(60,3,'LEON (5F1)','2012-01-01',NULL);
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
     VALUES(${GOLF},10,'1.6 TDI',1598,'Diesel','Dizel',110,81,'2012-08-01','golf');
    INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT 1,id FROM supplier_items;
    INSERT INTO storefront_model_fits(model_id,supplier_item_id) SELECT 10,id FROM supplier_items;
    INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
     ('trodo',3,NULL,'Yedek parçalar','yedek-parca','{3}','','{}'),('trodo',241,3,'Filtre','filtre','{3,241}','','{}');
    INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
     ('trodo',3,'tr','Yedek parçalar','yedek-parca'),('trodo',241,'tr','Filtre','filtre')`);
  await schema.pool.query("SELECT refresh_product_matches()");
  await addVehicleFit("BOSCH 1001");
  await addVehicleFit("BOSCH 1002");
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, epochModule, catalogModule, categoriesModule, { listingCacheStore }] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/listing-epoch"),
    import("../src/modules/store/catalog"), import("../src/modules/store/listing-categories.server"), import("../src/modules/store/listing-cache-store")]);
  models = listingCacheStore<string[]>("listed-models", 1);
  counts = listingCacheStore<[number, number][]>("category-counts", 1);
  epoch = epochModule;
  catalog = catalogModule;
  categories = categoriesModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("setup adds fits_epoch at 0, and applying the file again changes nothing", async () => {
  const added = await column();
  assert.deepEqual(added && { notnull: added.notnull, fallback: added.fallback }, { notnull: true, fallback: "0" });
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=3,fits_epoch=2");
  await applyOverrides();
  assert.deepEqual(await column(), added, "the same column");
  assert.deepEqual(await counters(), { epoch: 3, fits_epoch: 2, fits: 5 }, "the same values");
});

test("added to an existing row, the fits value starts at the epoch the stored rows carry", async () => {
  await schema.pool.query("ALTER TABLE storefront_listing_epoch DROP COLUMN fits_epoch");
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=7");
  await applyOverrides();
  assert.ok(await column());
  assert.deepEqual(await counters(), { epoch: 7, fits_epoch: 0, fits: 7 });
});

test("invalidateFits moves the fits value only; invalidateListings moves both; the fits value is never below the epoch", async () => {
  assert.deepEqual([await epoch.listingEpoch(), await epoch.fitsEpoch()], [7, 7]);
  await epoch.invalidateFits();
  assert.deepEqual([await epoch.listingEpoch(), await epoch.fitsEpoch()], [7, 8], "seen at once by the process that bumped");
  assert.deepEqual(await counters(), { epoch: 7, fits_epoch: 1, fits: 8 });
  await epoch.invalidateListings();
  assert.deepEqual([await epoch.listingEpoch(), await epoch.fitsEpoch()], [8, 9]);
  assert.deepEqual(await counters(), { epoch: 8, fits_epoch: 1, fits: 9 });
  // A raw bump (another task on the code before #1368) moves both values too.
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=epoch+1,bumped_at=now()");
  const other = await otherProcess("other");
  assert.deepEqual([await other.listingEpoch(), await other.fitsEpoch()], [9, 10], "another process reads both");
  for (let bump = 0; bump < 5; bump++) {
    await (bump % 2 ? epoch.invalidateListings() : epoch.invalidateFits());
    const [listing, fits] = [await epoch.listingEpoch(), await epoch.fitsEpoch()];
    assert.ok(fits >= listing, `bump ${bump}: ${fits} >= ${listing}`);
  }
});

test("the fit sync's bump reloads the make listing, its models and category counts; manufacturer and category listings stay cached", async () => {
  assert.deepEqual([await total(manufacturer), await total(category), await total(make)], [rows, rows, rows]);
  assert.deepEqual(await listedModels(), ["golf-7"]);
  assert.equal(await filterCount(), rows);
  await addFittedRow(20);
  assert.deepEqual([await total(make), await listedModels(), await filterCount()], [rows, ["golf-7"], rows], "no bump: the cached values");
  await epoch.invalidateFits();
  for (const query of [manufacturer, category]) {
    let shown = 0;
    assert.deepEqual(await loads(async () => { shown = await total(query); }), { loads: 0, other: 0 }, `${JSON.stringify(query)}: no statement`);
    assert.equal(shown, rows, `${JSON.stringify(query)}: the cached count`);
  }
  assert.equal(await total(make), rows + 1);
  assert.deepEqual(await listedModels(), ["golf-7", "polo-6"]);
  assert.equal(await filterCount(), rows + 1);
  // An admin edit's bump reaches every listing.
  await epoch.invalidateListings();
  assert.deepEqual([await total(manufacturer), await total(category), await total(make)], [rows + 1, rows + 1, rows + 1]);
});

test("a raw epoch bump from another task (the code before #1368) reloads a make listing within about a second", async () => {
  const before = await total(make);
  await addFittedRow(10);
  await schema.pool.query("UPDATE storefront_listing_epoch SET epoch=epoch+1,bumped_at=now()");
  await sleep(1100);
  assert.equal(await total(make), before + 1);
});

test("12 fit sync bumps reload a make listing 12 times and a manufacturer listing never; 12 admin bumps reload both", async () => {
  const reloads = async (bump: () => Promise<void>) => {
    const counted = { manufacturer: 0, make: 0 };
    for (let round = 0; round < 12; round++) {
      await bump();
      counted.manufacturer += (await loads(() => total(manufacturer))).loads;
      counted.make += (await loads(() => total(make))).loads;
    }
    return counted;
  };
  await Promise.all([total(manufacturer), total(make)]);
  assert.deepEqual(await reloads(() => epoch.invalidateListings()), { manufacturer: 12, make: 12 }, "before #1368 the fit sync bumped this way");
  assert.deepEqual(await reloads(() => epoch.invalidateFits()), { manufacturer: 0, make: 12 });
});

test("a search that may name a vehicle follows the fits value; a one-word or code search keeps its entry through the fit sync", async () => {
  const search = (q: string, code = false) => inRequest(() => catalog.browseProducts(code ? { q, searchBy: "code" } : { q }));
  // The search's hit read (searchHitIdsSql): a cached plain search sends none, its cards are read live.
  const hitReads = (run: () => Promise<unknown>) => loads(run, text => text.includes("WITH main AS MATERIALIZED"));
  const [word, vehicle, code] = [() => search("bosch"), () => search("bosch golf"), () => search("BOSCH 1001", true)];
  for (const read of [word, vehicle, code]) assert.ok((await hitReads(read)).loads > 0, "the first read searches");
  await epoch.invalidateFits();
  assert.equal((await hitReads(word)).loads, 0, "one word: no vehicle reading, cached");
  assert.equal((await hitReads(code)).loads, 0, "a code search: cached");
  assert.ok((await hitReads(vehicle)).loads > 0, "two words may read a vehicle's fits: reloaded");
  await epoch.invalidateListings();
  for (const read of [word, vehicle, code]) assert.ok((await hitReads(read)).loads > 0, "an admin edit's bump reloads every search");
});

test("after the fit sync's bump a make's listed models and category counts and a garage vehicle's listing wait at most LISTING_EPOCH_WAIT_MS", async () => {
  const vehicle = async () => (await inRequest(() => catalog.browseProducts({ fits: "vehicle" }, { vehicleTypeId: String(GOLF) }))).total;
  const read = async () => ({ models: (await listedModels()).length, filter: await filterCount(), vehicle: await vehicle() });
  const earlier = await read();
  assert.equal(earlier.vehicle, 2);
  // Tiguan gains its first fit (and Filtre a product); the garage's Golf a third fitted product.
  await addFittedRow(30);
  await addVehicleFit("BOSCH 1003");
  // The reloads read these tables: held, they wait while the pages are served.
  const locker = await schema.pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE storefront_model_fits,storefront_make_fits,product_override_fitments IN ACCESS EXCLUSIVE MODE");
    await withEnv({ LISTING_EPOCH_WAIT_MS: "0" }, async () => {
      await epoch.invalidateFits();
      const started = Date.now();
      assert.deepEqual(await read(), earlier, "the earlier values while the reloads wait");
      assert.ok(Date.now() - started < 2_000, "served without waiting for the held reloads");
      await locker.query("COMMIT");
      const expected = { models: earlier.models + 1, filter: (earlier.filter ?? 0) + 1, vehicle: earlier.vehicle + 1 };
      assert.deepEqual(await until(read, value => JSON.stringify(value) === JSON.stringify(expected)), expected);
    });
  } finally {
    await locker.query("ROLLBACK").catch(() => {});
    locker.release();
  }
});

// The listed models and the make/model category counts are persisted like the make listing (#1391): the audi make has no
// fits, so a row can only come from the seed or from a load, and the seeds' values differ from what a load finds.
// Loaded in before (after the isolated schema is selected), like the other store modules.
let models: StaleCacheStore<string[]>, counts: StaleCacheStore<[number, number][]>;
const audiModels = async () => (await catalog.getListedModelGroups("2")).map(group => group.slug).sort();
const audiCount = async () => (await inRequest(() => categories.scopeCategoryCounts({ make: "audi" }))).get(241);
const seatModels = async () => (await catalog.getListedModelGroups("3")).map(group => group.slug).sort();
const seatCount = async () => (await inRequest(() => categories.scopeCategoryCounts({ make: "seat" }))).get(241);
const stored = async (namespace: string) => (await schema.pool.query<{ epoch: number }>(
  "SELECT epoch::int FROM storefront_listing_cache WHERE namespace=$1", [namespace])).rows;
const reset = () => schema.pool.query("DELETE FROM storefront_listing_cache WHERE namespace IN ('listed-models','category-counts')");

test("a stored current listed models and category counts row is adopted on a cold key without a load", async () => {
  await reset();
  const current = await epoch.fitsEpoch();
  await models.write("2", ["40"], current);
  await counts.write("audi|", [[241, 5]], current);
  // The model list and the stored row are read, the fit tables are not.
  assert.equal((await loads(async () => { assert.deepEqual(await audiModels(), ["a3-8v1"]); }, text => text.includes("storefront_model_fits"))).loads, 0, "models");
  assert.equal((await loads(async () => { assert.equal(await audiCount(), 5); }, text => text.includes("storefront_make_fits"))).loads, 0, "counts");
});

test("loaded values are stored with the fits value, which the fit sync's bump moves ahead of the listing epoch", async () => {
  await reset();
  await epoch.invalidateListings();
  await epoch.invalidateFits();
  const current = await epoch.fitsEpoch();
  assert.ok(current > await epoch.listingEpoch());
  await audiModels();
  await audiCount();
  for (const namespace of ["listed-models", "category-counts"]) {
    assert.deepEqual(await until(() => stored(namespace), rows => rows.length > 0), [{ epoch: current }], namespace);
  }
});

test("an older stored row is served while a held reload runs, an empty one never, and the real value then replaces it", async () => {
  await reset();
  const current = await epoch.fitsEpoch(), older = current - 1;
  await models.write("3", ["60"], older);
  await counts.write("seat|", [], older);
  const locker = await schema.pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE storefront_model_fits,storefront_make_fits IN ACCESS EXCLUSIVE MODE");
    await withEnv({ LISTING_EPOCH_WAIT_MS: "0" }, async () => {
      // SEAT is read here for the first time: cold memory, so the stored rows are the only earlier values.
      const started = Date.now();
      assert.deepEqual(await seatModels(), ["leon-5f1"], "the stored value");
      assert.ok(Date.now() - started < 2_000, "served without waiting for the held reload");
      const waiting = seatCount();
      assert.equal(await Promise.race([waiting.then(() => "done"), sleep(500).then(() => "waiting")]), "waiting", "an empty value is not served");
      await locker.query("COMMIT");
      assert.equal(await waiting, undefined, "the real value: SEAT has no fits");
    });
    assert.deepEqual(await until(seatModels, value => value.length === 0), [], "the real value replaces the stored one");
    assert.deepEqual(await until(() => stored("listed-models"), rows => rows[0]?.epoch === current), [{ epoch: current }]);
  } finally {
    await locker.query("ROLLBACK").catch(() => {});
    locker.release();
  }
});

test("an older write never replaces a newer row, and LISTING_CACHE_PERSIST=0 writes nothing", async () => {
  await reset();
  const current = await epoch.fitsEpoch();
  await models.write("2", ["40"], current);
  await models.write("2", ["50"], current - 1);
  assert.deepEqual((await models.read("2"))?.value, ["40"]);
  await reset();
  await withEnv({ LISTING_CACHE_PERSIST: "0" }, async () => {
    await models.write("2", ["40"], current);
    await counts.write("audi|", [[241, 1]], current);
  });
  assert.deepEqual([await stored("listed-models"), await stored("category-counts")], [[], []]);
});

// Last: drops the column, as on a database whose setup has not run yet.
test("without the column both values read the epoch, both bumps move it, and nothing throws", async t => {
  await schema.pool.query("ALTER TABLE storefront_listing_epoch DROP COLUMN fits_epoch");
  const logged = t.mock.method(console, "error", () => {});
  const before = (await schema.pool.query<{ epoch: number }>("SELECT epoch::int FROM storefront_listing_epoch")).rows[0].epoch;
  await epoch.invalidateFits();
  await epoch.invalidateListings();
  const after = (await schema.pool.query<{ epoch: number }>("SELECT epoch::int FROM storefront_listing_epoch")).rows[0].epoch;
  assert.equal(after, before + 2, "each bump moved the epoch once");
  assert.equal(await epoch.listingEpoch(), after);
  assert.ok(await epoch.fitsEpoch() >= after);
  // A process that never saw the column: both values are the epoch.
  const fresh = await otherProcess("legacy");
  assert.deepEqual([await fresh.listingEpoch(), await fresh.fitsEpoch()], [after, after]);
  await fresh.invalidateFits();
  assert.deepEqual([await fresh.listingEpoch(), await fresh.fitsEpoch()], [after + 1, after + 1]);
  const messages = logged.mock.calls.map(call => String(call.arguments[0]));
  assert.deepEqual(messages, Array(2).fill("Listing epoch: fits_epoch is missing (setup not run yet); the fit caches follow the listing epoch for 5 minutes"),
    "once per process");
});
