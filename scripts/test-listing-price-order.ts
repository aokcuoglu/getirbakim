import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

// Stored whole price orders of the deep price-sorted pages (#1369) in an isolated copy of the schema: a plain listing's
// pages past the cached first 20 slice its order stored by one statement (storefront_listing_price_orders), with the
// ids, order and cards of the live page (LISTING_PRICE_ORDER=0), under the epoch and age rules of the cached pages.
// Pages 1-20 keep their 480 ids, taken from the stored order's first ids when that row is current and newer (#1389).
// Nothing is written to the shared database's tables.
type Catalog = typeof import("../src/modules/store/catalog");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: Catalog;
let priceOrder: typeof import("../src/modules/store/listing-price-order");
let invalidateListings: () => Promise<void>, invalidateFits: () => Promise<void>;
let closeDb: () => Promise<void>;
const [basbug] = storefrontCompanies();

// The category tree (getStoreCategories) calls connection(), which needs a request scope: a static work store lets it
// run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the other imports).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);

/** Another app process: a second copy of the catalog module, with its own process caches, on the same database and epoch. */
const otherProcess = async (name: string) => await import(`../src/modules/store/catalog.ts?${name}`) as Catalog;
/**
 * Polls `read` until `done` holds or the deadline passes (loads finish in the background). Timed by performance.now():
 * the tests that mock Date hold it still.
 */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || performance.now() > deadline) return value;
    await sleep(10);
  }
}
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
 * Runs `run` with every statement's text, on any connection, passed to `onText` first; an error it returns fails that
 * statement without sending it: a promise-style call (boundedQuery's, a named statement's) rejects with it, a
 * callback-style one (Pool.query's: db.query) has its callback called with it. The slices' touches still pending from
 * before (#1405, not awaited by the page) settle first, so they are neither seen nor failed here.
 */
async function intercepted(onText: (text: string) => Error | undefined, run: () => Promise<unknown>) {
  await priceOrder.sliceTouchesSettled();
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    const failure = onText(typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "");
    if (!failure) return (original as (...rest: unknown[]) => unknown).apply(this, args);
    const callback = args.find(arg => typeof arg === "function") as ((error: Error) => void) | undefined;
    if (!callback) return Promise.reject(failure);
    process.nextTick(() => callback(failure));
    return undefined;
  } as typeof original;
  try {
    await run();
  } finally {
    pg.Client.prototype.query = original;
  }
}
/** A slice's touch of last_sliced_at (#1405): not awaited and throttled per minute, counted by its own tests only. */
const isTouch = (text: string) => text.includes("SET last_sliced_at=now()");
/**
 * What `run` sends on any connection: stored-order builds, live price pages (ORDER BY … OFFSET), the first pages' 480-id
 * pricing passes (headPasses) and statements naming the table, touches apart.
 */
async function sent(run: () => Promise<unknown>) {
  const texts: string[] = [];
  await intercepted(text => { texts.push(text); return undefined; }, run);
  return {
    builds: texts.filter(text => text.includes("INSERT INTO storefront_listing_price_orders")).length,
    livePages: texts.filter(text => /ORDER BY unavailable,price_kurus (ASC|DESC) NULLS LAST,id LIMIT \d+ OFFSET/.test(text)).length,
    headPasses: texts.filter(text => /LIMIT 480\) page/.test(text)).length,
    table: texts.filter(text => text.includes("storefront_listing_price_orders") && !isTouch(text)).length,
  };
}

type Sort = "price-asc" | "price-desc";
const bosch = (sort: Sort, page: number): CatalogQuery => ({ manufacturer: "bosch", sort, page: String(page) });
const cards = (query: CatalogQuery, from: Catalog = catalog) => inRequest(async () => (await from.browseProducts(query)).items);
const pageIds = async (query: CatalogQuery, from: Catalog = catalog) => (await cards(query, from)).map(card => card.id);
/** The page read live, as before #1369 (pages 1-20: their cached 480 ids). */
const livePage = (query: CatalogQuery) => withEnv({ LISTING_PRICE_ORDER: "0" }, () => pageIds(query));
/** The BOSCH listing's whole price order, read now by one statement: what every page must show. */
const liveOrder = async (sort: Sort) => (await schema.pool.query<{ id: string }>(`SELECT id::text FROM (${catalog.storefrontCatalogSql}) catalog
  WHERE catalog.display_brand='BOSCH' ORDER BY unavailable,price_kurus ${sort === "price-asc" ? "ASC" : "DESC"} NULLS LAST,id`, [storefrontCompanies()])).rows.map(row => row.id);
const pageOf = (order: string[], page: number) => order.slice((page - 1) * 24, page * 24);
const stored = async () => (await schema.pool.query<{ epoch: number; total: number; age_s: number }>(
  "SELECT epoch::int,total,extract(epoch FROM now()-computed_at)::int AS age_s FROM storefront_listing_price_orders ORDER BY epoch DESC,total DESC")).rows;
const currentEpoch = async () => (await schema.pool.query<{ epoch: number }>("SELECT epoch::int FROM storefront_listing_epoch")).rows[0].epoch;
const hide = (id: string) => schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [id]);
/** BOSCH rows and pages: 560 rows (5 dropped by their supplier, listed last), 24 pages of 24 cards, the last one of 8. */
const rows = 560, pages = 24;
/** The oldest order the first pages' cache could take (its maxFallbackMs, catalog.ts), as the store is given it. */
const headMaxAgeMs = 48 * 60 * 60 * 1000;
const failure = (code: string) => Object.assign(new Error(`simulated ${code}`), { code });
/** A listing's rows by display brand ($2, after the companies), for builds called directly, and the ascending order. */
const brandRowsSql = () => `SELECT catalog.id,catalog.unavailable,catalog.price_kurus FROM (${catalog.storefrontCatalogSql}) catalog WHERE catalog.display_brand=$2`;
const ascending = "unavailable,price_kurus ASC NULLS LAST,id";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Sets every stored order's ids, epoch, age and last deep slice (`sliced` ago; null: none) once the slices' pending
 * touches have settled, and drops the stored page ids beside it: the first pages then take the order or price their own.
 */
async function setOrder(ids: string[], epoch: number, age: string, sliced: string | null) {
  await priceOrder.sliceTouchesSettled();
  await schema.pool.query("UPDATE storefront_listing_price_orders SET ids=$1::uuid[],epoch=$2,computed_at=now()-$3::interval,last_sliced_at=now()-$4::interval",
    [ids, epoch, age, sliced]);
  await schema.pool.query("DELETE FROM storefront_listing_cache WHERE namespace='page-ids'");
}
/** Waits until no statement has been sent on any connection for `ms`: background loads and their last reads are done. */
async function quiet(ms = 200) {
  let last = performance.now();
  await intercepted(() => { last = performance.now(); return undefined; }, async () => {
    while (performance.now() - last < ms) await sleep(20);
  });
}

before(async () => {
  schema = await isolatedSchema("listing_price_order_test");
  const brand = async (key: string) => (await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES($1,$1) RETURNING id::text", [key])).rows[0].id;
  const [boschBrand, mahleBrand] = [await brand("BOSCH"), await brand("MAHLE")];
  await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES('basbug','BOSCH',$1,$3),('basbug','MAHLE',$2,5)", [boschBrand, mahleBrand, rows]);
  // Costs 40-239 over 560 rows: every price is shared by two or three rows, ordered by id. Every hundredth row was dropped
  // by its supplier: an unavailable card without a price. MAHLE: five rows of one price.
  const insert = `INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)`;
  await schema.pool.query(`${insert} SELECT 'basbug',$1,'G','MRK','BOSCH P'||n,jsonb_build_object('uk','BOSCH','ac','P'||n||' PARCA','ac2','','dc','TL'),
    jsonb_build_object('nf',40+(n*37)%200),'{"stok":2}',1,1,1,CASE WHEN n%100=0 THEN 'inactive' ELSE 'present' END,now()-interval '30 days',now(),now()
    FROM generate_series(1,$2::int) n`, [basbug, rows]);
  await schema.pool.query(`${insert} SELECT 'basbug',$1,'G','MRK','MAHLE M'||n,jsonb_build_object('uk','MAHLE','ac','M'||n||' PARCA','ac2','','dc','TL'),
    '{"nf":100}','{"stok":2}',1,1,1,'present',now()-interval '30 days',now(),now() FROM generate_series(1,5) n`, [basbug]);
  // VW fits every BOSCH row; so does its model Golf 7.
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF VII (5G1)','2012-08-01','2017-03-01');
    INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT 1,id FROM supplier_items WHERE code LIKE 'BOSCH %';
    INSERT INTO storefront_model_fits(model_id,supplier_item_id) SELECT 10,id FROM supplier_items WHERE code LIKE 'BOSCH %'`);
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, catalogModule, priceOrderModule, epoch] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"),
    import("../src/modules/store/listing-price-order"), import("../src/modules/store/listing-epoch")]);
  catalog = catalogModule;
  priceOrder = priceOrderModule;
  invalidateListings = epoch.invalidateListings;
  invalidateFits = epoch.invalidateFits;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("every page of both price orders is the live page, the partial last one too", async () => {
  for (const sort of ["price-asc", "price-desc"] as const) {
    const all: Awaited<ReturnType<typeof cards>> = [];
    for (let page = 1; page <= pages; page++) {
      const shown = await cards(bosch(sort, page));
      assert.deepEqual(shown.map(card => card.id), await livePage(bosch(sort, page)), `${sort} page ${page}`);
      all.push(...shown);
    }
    assert.equal(all.length, rows);
    assert.equal(all.length - (pages - 1) * 24, 8, "the last page holds 8 cards");
    assert.equal(new Set(all.map(card => card.id)).size, rows, "no card twice");
    // The order itself, so the comparison is not between two wrong answers: prices (ties by id), unavailable cards last.
    const saleable = all.slice(0, rows - 5);
    assert.ok(saleable.every(card => card.price_kurus !== null && !card.unavailable), "priced rows first");
    assert.ok(all.slice(rows - 5).every(card => card.unavailable && card.price_kurus === null));
    const direction = sort === "price-asc" ? 1 : -1;
    let ties = 0;
    for (let index = 1; index < saleable.length; index++) {
      const [previous, card] = [saleable[index - 1], saleable[index]];
      const step = (card.price_kurus! - previous.price_kurus!) * direction;
      assert.ok(step > 0 || (step === 0 && previous.id < card.id), `${sort}: ${index}`);
      if (step === 0) ties++;
    }
    assert.ok(ties > 300, "most prices are shared");
  }
});

test("pages 21-23 send one build and no live page; pages 1-20 neither, their reload looks for a stored order and its deep use once", async () => {
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  assert.deepEqual(await sent(async () => { for (let page = 1; page <= 20; page++) await pageIds(bosch("price-asc", page)); }),
    { builds: 0, livePages: 0, headPasses: 1, table: 2 });
  const deep = await sent(async () => { for (let page = 21; page <= 23; page++) await pageIds(bosch("price-asc", page)); });
  assert.deepEqual({ builds: deep.builds, livePages: deep.livePages }, { builds: 1, livePages: 0 });
});

test("one stored row per listing and sort, of the listing's count and the current epoch; the cached first pages' row stays as it was", async () => {
  const pageIdRows = async () => (await schema.pool.query<{ key_hash: string; epoch: string; computed_at: Date; ids: number }>(
    "SELECT key_hash,epoch::text,computed_at,jsonb_array_length(value) AS ids FROM storefront_listing_cache WHERE namespace='page-ids' ORDER BY key_hash")).rows;
  await pageIds(bosch("price-desc", 1));
  const epoch = String(await currentEpoch());
  const before = await until(pageIdRows, found => found.length === 2 && found.every(row => row.epoch === epoch));
  assert.deepEqual(before.map(row => row.ids), [480, 480], "the first 20 pages of each order");
  for (const sort of ["price-asc", "price-desc"] as const) for (let page = 21; page <= pages; page++) await pageIds(bosch(sort, page));
  assert.deepEqual((await stored()).map(row => [row.epoch, row.total]), [[Number(epoch), rows], [Number(epoch), rows]]);
  await sleep(50);
  assert.deepEqual(await pageIdRows(), before);
});

test("with a current order every page of both orders is the live order; another process prices none of pages 1-20 again", async () => {
  for (const sort of ["price-asc", "price-desc"] as const) await pageIds(bosch(sort, 21));
  // Without stored page ids: the other process's first pages can only come from the stored orders or a pass.
  await schema.pool.query("DELETE FROM storefront_listing_cache WHERE namespace='page-ids'");
  const other = await otherProcess("heads");
  for (const sort of ["price-asc", "price-desc"] as const) {
    const order = await liveOrder(sort), shown: string[] = [];
    const statements = await sent(async () => { for (let page = 1; page <= pages; page++) shown.push(...await pageIds(bosch(sort, page), other)); });
    assert.deepEqual(shown, order, sort);
    assert.deepEqual({ builds: statements.builds, livePages: statements.livePages, headPasses: statements.headPasses }, { builds: 0, livePages: 0, headPasses: 0 }, sort);
    for (let page = 1; page <= pages; page++) assert.deepEqual(await pageIds(bosch(sort, page)), pageOf(order, page), `${sort} page ${page}, this process`);
  }
});

test("one pricing pass per listing: page 21 then page 1 builds once and prices no 480 ids; a cold page 1 without an order prices 480 ids and builds nothing", async () => {
  const cold = async () => {
    await schema.pool.query("TRUNCATE storefront_listing_price_orders");
    await schema.pool.query("DELETE FROM storefront_listing_cache WHERE namespace='page-ids'");
  };
  const order = await liveOrder("price-asc");
  await cold();
  const deepFirst = await otherProcess("deep-first");
  const passes = await sent(async () => {
    assert.deepEqual(await pageIds(bosch("price-asc", 21), deepFirst), pageOf(order, 21));
    assert.deepEqual(await pageIds(bosch("price-asc", 1), deepFirst), pageOf(order, 1));
  });
  assert.deepEqual({ builds: passes.builds, headPasses: passes.headPasses, livePages: passes.livePages }, { builds: 1, headPasses: 0, livePages: 0 });
  await cold();
  const firstOnly = await otherProcess("first-only");
  const first = await sent(async () => assert.deepEqual(await pageIds(bosch("price-asc", 1), firstOnly), pageOf(order, 1)));
  assert.deepEqual({ builds: first.builds, headPasses: first.headPasses, livePages: first.livePages }, { builds: 0, headPasses: 1, livePages: 0 });
  assert.deepEqual(await stored(), [], "page 1 never builds");
});

test("after an epoch bump pages 20 and 21 read one order: a price changed after page 21 built it moves neither", async () => {
  const sort = "price-asc";
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  // The first pages cached under this epoch by their own pass (no order stored yet).
  const before = await liveOrder(sort);
  assert.deepEqual(await pageIds(bosch(sort, 20)), pageOf(before, 20));
  // An admin edit's bump: page 21 reloads first and stores the order.
  await invalidateListings();
  assert.equal((await sent(async () => assert.deepEqual(await pageIds(bosch(sort, 21)), pageOf(before, 21)))).builds, 1);
  // The first card of page 21 becomes the cheapest: a pass priced now would move every card before it one place down.
  const moved = before[480];
  const { rows: [original] } = await schema.pool.query<{ price_data: unknown }>("SELECT price_data FROM supplier_items WHERE id=$1", [moved]);
  await schema.pool.query(`UPDATE supplier_items SET price_data='{"nf":1}' WHERE id=$1`, [moved]);
  try {
    const now = await liveOrder(sort);
    assert.equal(now[0], moved);
    assert.notDeepEqual(pageOf(now, 20), pageOf(before, 20), "a separate pass would give page 20 another set of cards");
    let page20: string[] = [];
    const reload = await sent(async () => { page20 = await pageIds(bosch(sort, 20)); });
    assert.deepEqual({ builds: reload.builds, headPasses: reload.headPasses }, { builds: 0, headPasses: 0 }, "the stored order's first ids, not a pass");
    const page21 = await pageIds(bosch(sort, 21));
    assert.deepEqual([page20, page21], [pageOf(before, 20), pageOf(before, 21)]);
    assert.deepEqual(page20.filter(id => page21.includes(id)), [], "no card on both pages");
  } finally {
    await schema.pool.query("UPDATE supplier_items SET price_data=$2 WHERE id=$1", [moved, original.price_data]);
    await schema.pool.query("TRUNCATE storefront_listing_price_orders");
    await invalidateListings();
  }
});

test("the first pages' store returns the newer of the stored page ids and the stored order's first ids", async t => {
  const pricedSql = `SELECT catalog.id,catalog.unavailable,catalog.price_kurus FROM (${catalog.storefrontCatalogSql}) catalog WHERE catalog.display_brand=$2`;
  const key = "test|head", order = "unavailable,price_kurus ASC NULLS LAST,id";
  assert.ok((await priceOrder.buildPriceOrder(key, 1000, pricedSql, [storefrontCompanies(), "BOSCH"], order)).total > 3);
  await schema.pool.query("UPDATE storefront_listing_price_orders SET computed_at=now()-interval '1 minute' WHERE epoch=1000");
  const first = await priceOrder.priceOrderSlice(key, 0, 3);
  let pageIdRow: { value: string[]; ageMs: number; epoch: number } | null = null;
  const written: unknown[] = [];
  const store = priceOrder.priceOrderHeadStore({ read: async () => pageIdRow, write: async (...args) => { written.push(args); } }, () => 3, headMaxAgeMs);
  const read = async () => { const row = await store.read(key); return row && [row.value, row.epoch]; };
  assert.deepEqual(await read(), [first, 1000], "no page ids: the order's first ids");
  pageIdRow = { value: ["page-ids"], ageMs: 0, epoch: 999 };
  assert.deepEqual(await read(), [first, 1000], "an older epoch's page ids");
  pageIdRow = { value: ["page-ids"], ageMs: 10 * 60 * 1000, epoch: 1001 };
  assert.deepEqual(await read(), [["page-ids"], 1001], "a newer epoch's page ids, however old");
  pageIdRow = { value: ["page-ids"], ageMs: 30_000, epoch: 1000 };
  assert.deepEqual(await read(), [["page-ids"], 1000], "the same epoch: the younger page ids");
  pageIdRow = { value: ["page-ids"], ageMs: 120_000, epoch: 1000 };
  assert.deepEqual(await read(), [first, 1000], "the same epoch: the younger order");
  const ageMs = (await store.read(key))!.ageMs;
  assert.ok(ageMs >= 60_000 && ageMs < 120_000, "the order's age");
  assert.deepEqual(await store.read("test|no-order"), { ...pageIdRow }, "no order");
  for (const setting of [{ LISTING_PRICE_ORDER: "0" }, { LISTING_CACHE_PERSIST: "0" }]) await withEnv(setting, async () => {
    const statements = await sent(async () => assert.deepEqual(await read(), [["page-ids"], 1000]));
    assert.equal(statements.table, 0, `${JSON.stringify(setting)}: the page ids only`);
  });
  // An order past the oldest any caller may take is not read (its array not unpacked), even beside older page ids.
  pageIdRow = { value: ["page-ids"], ageMs: 0, epoch: 999 };
  await schema.pool.query("UPDATE storefront_listing_price_orders SET computed_at=now()-interval '49 hours' WHERE epoch=1000");
  assert.deepEqual(await read(), [["page-ids"], 999], "49 hours old: not read");
  await schema.pool.query("UPDATE storefront_listing_price_orders SET computed_at=now()-interval '47 hours' WHERE epoch=1000");
  assert.deepEqual(await read(), [first, 1000], "47 hours old: read (a fallback while the cache reloads)");
  pageIdRow = { value: ["page-ids"], ageMs: 120_000, epoch: 1000 };
  const logged = t.mock.method(console, "error", () => {});
  await intercepted(text => text.includes("storefront_listing_price_orders") ? failure("XX000") : undefined,
    async () => assert.deepEqual(await read(), [["page-ids"], 1000], "a failed order read: the page ids"));
  assert.match(String(logged.mock.calls[0]?.arguments[0]), /^Listing price order: head failed/);
  await store.write(key, ["a", "b"], 1002);
  assert.deepEqual(written, [[key, ["a", "b"], 1002]], "writes go to the page ids");
  await schema.pool.query("DELETE FROM storefront_listing_price_orders WHERE epoch=1000");
});

test("the first pages take an order of an older epoch or past 24 hours never; one past 10 minutes once, while their pass runs", async () => {
  const sort = "price-asc", order = await liveOrder(sort), reversed = [...order].reverse();
  // This listing's order alone, current; then reversed (its first ids show when taken), with no stored page ids beside it,
  // and no deep page's slice recorded: the first pages price their own ids (#1405, the next test).
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  assert.deepEqual(await pageIds(bosch(sort, 21)), pageOf(order, 21));
  const epoch = await currentEpoch();
  const prepare = (epochValue: number, age: string) => setOrder(reversed, epochValue, age, null);
  try {
    await prepare(epoch, "11 minutes");
    const stale = await otherProcess("stale-head");
    const served = await sent(async () => assert.deepEqual(await pageIds(bosch(sort, 1), stale), pageOf(reversed, 1), "11 minutes old: served at once"));
    assert.deepEqual({ builds: served.builds, livePages: served.livePages }, { builds: 0, livePages: 0 });
    assert.deepEqual(await until(() => pageIds(bosch(sort, 1), stale), ids => JSON.stringify(ids) === JSON.stringify(pageOf(order, 1))), pageOf(order, 1), "then its own pass");
    for (const [label, epochValue, age] of [["an older epoch", epoch - 1, "0 seconds"], ["25 hours old", epoch, "25 hours"]] as const) {
      await prepare(epochValue, age);
      const other = await otherProcess(`refused-head-${label.replaceAll(" ", "-")}`);
      const statements = await sent(async () => assert.deepEqual(await pageIds(bosch(sort, 20), other), pageOf(order, 20), label));
      assert.deepEqual({ builds: statements.builds, headPasses: statements.headPasses }, { builds: 0, headPasses: 1 }, label);
    }
  } finally {
    await schema.pool.query("TRUNCATE storefront_listing_price_orders");
    await invalidateListings();
  }
});

test("a deep page's slice within 20 minutes makes the first pages rebuild the order they refuse instead of pricing 480 ids (#1405)", async () => {
  const sort = "price-asc", order = await liveOrder(sort), reversed = [...order].reverse();
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  assert.deepEqual(await pageIds(bosch(sort, 21)), pageOf(order, 21));
  const epoch = await currentEpoch();
  try {
    await setOrder(reversed, epoch, "11 minutes", "19 minutes");
    const stale = await otherProcess("stale-head-in-use");
    const refreshed = await sent(async () => {
      assert.deepEqual(await pageIds(bosch(sort, 1), stale), pageOf(reversed, 1), "11 minutes old: served at once");
      assert.deepEqual(await until(() => pageIds(bosch(sort, 1), stale), ids => same(ids, pageOf(order, 1))), pageOf(order, 1), "then the rebuilt order's");
    });
    assert.deepEqual({ builds: refreshed.builds, headPasses: refreshed.headPasses, livePages: refreshed.livePages }, { builds: 1, headPasses: 0, livePages: 0 }, "11 minutes old");
    assert.deepEqual((await stored()).map(row => [row.epoch, row.age_s < 60]), [[epoch, true]], "the order rebuilt");
    assert.deepEqual([await pageIds(bosch(sort, 20), stale), await pageIds(bosch(sort, 21), stale)], [pageOf(order, 20), pageOf(order, 21)],
      "pages 20 and 21 from the rebuilt order");
    for (const [label, sliced, expected] of [["sliced a minute ago", "1 minute", { builds: 1, headPasses: 0 }], ["sliced 21 minutes ago", "21 minutes", { builds: 0, headPasses: 1 }]] as const) {
      await setOrder(reversed, epoch - 1, "0 seconds", sliced);
      const other = await otherProcess(`older-epoch-head-${sliced.replace(" ", "-")}`);
      const statements = await sent(async () => assert.deepEqual(await pageIds(bosch(sort, 20), other), pageOf(order, 20), label));
      assert.deepEqual({ builds: statements.builds, headPasses: statements.headPasses }, expected, `an older epoch, ${label}`);
    }
  } finally {
    await schema.pool.query("TRUNCATE storefront_listing_price_orders");
    await invalidateListings();
  }
});

test("a missing table found by the first pages' order read turns the stored orders off: no statement names it afterwards", async t => {
  // A copy of the module, so the switch it sets (five minutes) stays out of the other tests.
  const copy = "missing-head", fresh = await import(`../src/modules/store/listing-price-order.ts?${copy}`) as typeof priceOrder;
  const logged = t.mock.method(console, "error", () => {});
  const store = fresh.priceOrderHeadStore({ read: async () => null, write: async () => {} }, () => 3, headMaxAgeMs);
  let failed = 0;
  await intercepted(text => text.includes("storefront_listing_price_orders") ? (failed++, failure("42P01")) : undefined,
    async () => assert.equal(await store.read("test|missing"), null));
  assert.equal(failed, 1);
  assert.equal(fresh.priceOrderEnabled(), false);
  assert.equal(priceOrder.priceOrderEnabled(), true, "the module the pages use is untouched");
  const after = await sent(async () => {
    assert.equal(await store.read("test|missing"), null);
    assert.equal(await fresh.priceOrderSlice("test|missing", 0, 24), null);
    assert.equal(await fresh.priceOrderStore.read("test|missing"), null);
  });
  assert.equal(after.table, 0);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /^Listing price order: head failed: storefront_listing_price_orders is missing/);
});

test("a make listing's first pages take its order under the fits value; after the fit sync's bump an order of the old value is priced again (#1368)", async () => {
  const fitsValue = async () => (await schema.pool.query<{ fits: number }>("SELECT (epoch+fits_epoch)::int AS fits FROM storefront_listing_epoch")).rows[0].fits;
  const make = (page: number): CatalogQuery => ({ make: "vw", sort: "price-asc", page: String(page) });
  const order = await liveOrder("price-asc"), reversed = [...order].reverse();
  // The fits value ahead of the listing epoch, so the row's tag tells which one it carries.
  await invalidateFits();
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await schema.pool.query("DELETE FROM storefront_listing_cache WHERE namespace='page-ids'");
  try {
    assert.deepEqual(await pageIds(make(21), await otherProcess("make-deep")), pageOf(order, 21));
    const fits = await fitsValue();
    assert.ok(fits > await currentEpoch());
    assert.deepEqual((await stored()).map(row => row.epoch), [fits], "the make's order carries the fits value");
    // Reversed: its first ids show when the first pages take them. No deep page's slice recorded: a refused order is
    // priced by the first pages' own pass.
    await priceOrder.sliceTouchesSettled();
    await schema.pool.query("UPDATE storefront_listing_price_orders SET ids=$1::uuid[],last_sliced_at=NULL", [reversed]);
    const other = await otherProcess("make-first-pages");
    const adopted = await sent(async () => assert.deepEqual(await pageIds(make(1), other), pageOf(reversed, 1), "the order's first ids"));
    assert.deepEqual({ builds: adopted.builds, headPasses: adopted.headPasses }, { builds: 0, headPasses: 0 });
    await invalidateFits();
    const reloaded = await sent(async () => assert.deepEqual(await pageIds(make(1), other), pageOf(order, 1), "priced again"));
    assert.deepEqual({ builds: reloaded.builds, headPasses: reloaded.headPasses }, { builds: 0, headPasses: 1 }, "the old fits value's order is refused");
    // With a deep page's slice a minute ago (#1405), the next bump's reload rebuilds the order under the new fits value
    // instead: during a fit sync each such reload is a whole build.
    await schema.pool.query("UPDATE storefront_listing_price_orders SET last_sliced_at=now()-interval '1 minute'");
    await invalidateFits();
    const rebuilt = await sent(async () => assert.deepEqual(await pageIds(make(1), other), pageOf(order, 1), "rebuilt"));
    assert.deepEqual({ builds: rebuilt.builds, headPasses: rebuilt.headPasses }, { builds: 1, headPasses: 0 }, "a deep page in use: the order rebuilt");
    assert.deepEqual((await stored()).map(row => row.epoch), [await fitsValue()], "under the new fits value");
  } finally {
    await schema.pool.query("TRUNCATE storefront_listing_price_orders");
    await invalidateListings();
  }
});

test("LISTING_PRICE_ORDER=0 or LISTING_CACHE_PERSIST=0 keeps pages 1-20 off the table; brand-filtered, search and model listings never read it there", async () => {
  for (const sort of ["price-asc", "price-desc"] as const) await pageIds(bosch(sort, 21));
  const orders = { "price-asc": await liveOrder("price-asc"), "price-desc": await liveOrder("price-desc") };
  for (const setting of [{ LISTING_PRICE_ORDER: "0" }, { LISTING_CACHE_PERSIST: "0" }]) await withEnv(setting, async () => {
    const other = await otherProcess(`off-first-pages-${Object.keys(setting)[0]}`);
    const fresh = await sent(async () => {
      for (const sort of ["price-asc", "price-desc"] as const) for (const page of [1, 20]) assert.deepEqual(await pageIds(bosch(sort, page), other), pageOf(orders[sort], page));
    });
    assert.deepEqual({ table: fresh.table, headPasses: fresh.headPasses }, { table: 0, headPasses: 2 }, `${JSON.stringify(setting)}: each order's 480 ids priced`);
    const warm = await sent(async () => { for (const sort of ["price-asc", "price-desc"] as const) for (const page of [1, 20]) await pageIds(bosch(sort, page)); });
    assert.equal(warm.table, 0, `${JSON.stringify(setting)}, this process`);
  });
  const listings: CatalogQuery[] = [{ manufacturer: "bosch", brands: JSON.stringify(["BOSCH"]) }, { q: "bosch" }, { make: "vw", model: "golf-7" }];
  const other = await otherProcess("first-pages-not-stored");
  for (const listing of listings) {
    const statements = await sent(() => pageIds({ ...listing, sort: "price-desc", page: "1" }, other));
    assert.equal(statements.table, 0, JSON.stringify(listing));
  }
  const make = await sent(() => pageIds({ make: "vw", sort: "price-desc", page: "1" }, other));
  assert.equal(make.table, 2, "a make listing's first page looks for its stored order and its deep use on a miss");
});

test("a failing order read on the first pages shows the live ids", async t => {
  const sort = "price-desc", order = await liveOrder(sort);
  assert.deepEqual(await pageIds(bosch(sort, 21)), pageOf(order, 21));
  await schema.pool.query("DELETE FROM storefront_listing_cache WHERE namespace='page-ids'");
  // Logged at most once a minute per kind: the store's test above logged this kind already.
  t.mock.method(console, "error", () => {});
  let failures = 0;
  const failReads = (text: string) => {
    if (!text.includes("storefront_listing_price_orders") || text.includes("INSERT")) return undefined;
    failures++;
    return failure("XX000");
  };
  const other = await otherProcess("failing-head");
  let statements: Awaited<ReturnType<typeof sent>> | undefined;
  await intercepted(failReads, async () => {
    statements = await sent(async () => {
      for (const page of [1, 20]) assert.deepEqual(await pageIds(bosch(sort, page), other), pageOf(order, page), `page ${page}`);
    });
  });
  assert.equal(failures, 2, "the head read and the deep-use read failed");
  assert.equal(statements?.headPasses, 1, "the page priced its own 480 ids");
  assert.equal(priceOrder.priceOrderEnabled(), true, "only a missing table turns the stored orders off");
});

test("cards are read live: a price and stock change shows on its card in the same position", async () => {
  const query = bosch("price-asc", 22), shown = await cards(query);
  const card = shown[3];
  const { rows: [original] } = await schema.pool.query<{ price_data: unknown; stock_data: unknown }>("SELECT price_data,stock_data FROM supplier_items WHERE id=$1", [card.id]);
  await schema.pool.query(`UPDATE supplier_items SET price_data='{"nf":5000}',stock_data='{"stok":0}' WHERE id=$1`, [card.id]);
  try {
    const changed = await cards(query);
    assert.deepEqual(changed.map(row => row.id), shown.map(row => row.id), "no bump: the stored order");
    assert.ok(changed[3].price_kurus! > card.price_kurus!, "the new price");
    assert.equal(card.available, true);
    assert.equal(changed[3].available, false, "the new stock");
  } finally {
    await schema.pool.query("UPDATE supplier_items SET price_data=$2,stock_data=$3 WHERE id=$1", [card.id, original.price_data, original.stock_data]);
  }
});

test("an epoch bump after hiding a product stores the order without it", async () => {
  const query = bosch("price-asc", 21), shown = await pageIds(query), hidden = shown[5];
  const epochBefore = (await stored())[0].epoch;
  await hide(hidden);
  assert.deepEqual(await pageIds(query), shown.filter(id => id !== hidden), "no bump: the stored order, the hidden card left out");
  await invalidateListings();
  const reloaded = await pageIds(query);
  assert.equal(reloaded.length, 24);
  assert.ok(!reloaded.includes(hidden));
  assert.deepEqual(reloaded, await livePage(query));
  assert.deepEqual((await stored()).map(row => row.epoch), [await currentEpoch(), epochBefore], "price-asc rebuilt, price-desc not read since");
  assert.ok((await currentEpoch()) > epochBefore);
});

test("with LISTING_EPOCH_WAIT_MS=0 the earlier stored order is served while the build runs, then the new one", async () => {
  const query = bosch("price-asc", 22), shown = await pageIds(query), hidden = shown[7];
  await hide(hidden);
  // Holds the stored rows, so the build waits on them (its ON CONFLICT update) while the page reads them.
  const locker = await schema.pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("SELECT 1 FROM storefront_listing_price_orders FOR UPDATE");
    await withEnv({ LISTING_EPOCH_WAIT_MS: "0" }, async () => {
      await invalidateListings();
      assert.deepEqual(await pageIds(query), shown.filter(id => id !== hidden), "the earlier order, the hidden card left out");
      await locker.query("COMMIT");
      const live = await livePage(query);
      assert.deepEqual(await until(() => pageIds(query), ids => JSON.stringify(ids) === JSON.stringify(live)), live);
    });
  } finally {
    await locker.query("ROLLBACK").catch(() => {});
    locker.release();
  }
  assert.equal((await stored())[0].epoch, await currentEpoch());
});

test("another process adopts a stored order; one past 24 hours is served while it is rebuilt, one past 48 hours is not served", async () => {
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  const query = bosch("price-asc", 21), live = await livePage(query);
  assert.deepEqual(await pageIds(query), live);
  assert.equal((await stored()).length, 1);
  const first = await otherProcess("first");
  let shown: string[] = [];
  assert.deepEqual(await sent(async () => { shown = await pageIds(query, first); }), { builds: 0, livePages: 0, headPasses: 0, table: 2 }, "the size, then the slice");
  assert.deepEqual(shown, live);
  // The stored order reversed and aged: served, the page shows its slice; rebuilt, the page is the live one again.
  const reverse = (hours: number) => schema.pool.query(`UPDATE storefront_listing_price_orders SET computed_at=now()-make_interval(hours=>$1),
    ids=ARRAY(SELECT id FROM unnest(ids) WITH ORDINALITY u(id,n) ORDER BY n DESC)`, [hours]);
  const reversedPage = async () => (await schema.pool.query<{ ids: string[] }>("SELECT ids[481:504]::text[] AS ids FROM storefront_listing_price_orders")).rows[0].ids;
  await reverse(25);
  const old = await reversedPage();
  assert.notDeepEqual(old, live);
  const locker = await schema.pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("SELECT 1 FROM storefront_listing_price_orders FOR UPDATE");
    await withEnv({ LISTING_EPOCH_WAIT_MS: "0" }, async () => {
      const second = await otherProcess("second");
      assert.deepEqual(await pageIds(query, second), old, "25 hours old: served while the build waits");
      await locker.query("COMMIT");
      assert.deepEqual(await until(() => pageIds(query, second), ids => JSON.stringify(ids) === JSON.stringify(live)), live);
    });
  } finally {
    await locker.query("ROLLBACK").catch(() => {});
    locker.release();
  }
  assert.ok((await stored())[0].age_s < 60, "rebuilt");
  await reverse(49);
  await withEnv({ LISTING_EPOCH_WAIT_MS: "0" }, async () => {
    assert.deepEqual(await pageIds(query, await otherProcess("third")), live, "49 hours old: the page waits for the build");
  });
  assert.deepEqual(await reversedPage(), live);
});

test("an older build never replaces a newer row; a listing over LISTING_PRICE_ORDER_MAX_IDS stores nothing", async () => {
  const pricedSql = `SELECT catalog.id,catalog.unavailable,catalog.price_kurus FROM (${catalog.storefrontCatalogSql}) catalog WHERE catalog.display_brand=$2`;
  const order = "unavailable,price_kurus ASC NULLS LAST,id", build = (key: string, epoch: number, brand: string) => priceOrder.buildPriceOrder(key, epoch, pricedSql, [storefrontCompanies(), brand], order);
  const listed = Number((await schema.pool.query<{ n: string }>(`SELECT count(*) AS n FROM (${catalog.storefrontCatalogSql}) catalog WHERE catalog.display_brand='BOSCH'`, [storefrontCompanies()])).rows[0].n);
  assert.deepEqual(await build("test|epochs", 1000, "BOSCH"), { total: listed, head: [] }, "no head asked: none returned");
  const boschFirst = await priceOrder.priceOrderSlice("test|epochs", 0, 3);
  assert.equal(boschFirst?.length, 3);
  assert.deepEqual(await build("test|epochs", 999, "MAHLE"), { total: 0, head: [] }, "an older epoch: nothing stored");
  assert.deepEqual(await priceOrder.priceOrderSlice("test|epochs", 0, 3), boschFirst);
  assert.deepEqual(await build("test|epochs", 1000, "MAHLE"), { total: 5, head: [] }, "the same epoch replaces it");
  const meta = await priceOrder.priceOrderStore.read("test|epochs");
  assert.deepEqual([meta?.value, meta?.epoch], [{ total: 5 }, 1000]);
  assert.deepEqual(await priceOrder.priceOrderSlice("test|epochs", 3, 24), (await priceOrder.priceOrderSlice("test|epochs", 0, 5))!.slice(3), "a slice ends with the order");
  assert.deepEqual(await priceOrder.priceOrderSlice("test|epochs", 5, 24), [], "past the end: empty");
  assert.equal(await priceOrder.priceOrderSlice("test|missing", 0, 24), null, "no row");
  await withEnv({ LISTING_PRICE_ORDER_MAX_IDS: "100" }, async () => {
    assert.deepEqual(await build("test|cap", 1000, "BOSCH"), { total: 0, head: [] });
    assert.deepEqual(await build("test|cap", 1000, "MAHLE"), { total: 5, head: [] });
  });
  assert.deepEqual(await build("test|empty", 1000, "NOBODY"), { total: 0, head: [] });
  assert.equal(await priceOrder.priceOrderStore.read("test|empty"), null);
});

test("concurrent builds of one key and epoch send one statement; a row of the epoch stored within freshMs is returned instead; the head is the order's first ids (#1405)", async () => {
  const key = "test|single", values = [storefrontCompanies(), "BOSCH"], fresh = { head: 30, freshMs: 10 * 60 * 1000 };
  const build = (epoch: number, options?: { head?: number; freshMs?: number }) => priceOrder.buildPriceOrder(key, epoch, brandRowsSql(), values, ascending, options);
  const listed = Number((await schema.pool.query<{ n: string }>(`SELECT count(*) AS n FROM (${catalog.storefrontCatalogSql}) catalog WHERE catalog.display_brand='BOSCH'`, [storefrontCompanies()])).rows[0].n);
  const row = async () => (await schema.pool.query<{ epoch: number; computed_at: Date }>("SELECT epoch::int,computed_at FROM storefront_listing_price_orders WHERE epoch BETWEEN 2000 AND 2999")).rows;
  let both: Awaited<ReturnType<typeof build>>[] = [];
  const concurrent = await sent(async () => { both = await Promise.all([build(2000, fresh), build(2000, fresh)]); });
  assert.equal(concurrent.builds, 1, "one statement for both");
  assert.equal(both[0].total, listed);
  assert.deepEqual(both[1], both[0]);
  assert.deepEqual(both[0].head, await priceOrder.priceOrderSlice(key, 0, 30), "the head is the stored order's first ids");
  const [built] = await row();
  // A row of this epoch (or a newer one) stored within freshMs: returned, nothing built.
  for (const epoch of [2000, 1999]) {
    let again: Awaited<ReturnType<typeof build>> | undefined;
    assert.equal((await sent(async () => { again = await build(epoch, fresh); })).builds, 0, `epoch ${epoch}`);
    assert.deepEqual(again, both[0], `epoch ${epoch}: the stored row`);
  }
  assert.deepEqual(await row(), [built], "the row stays as it was");
  // Older than freshMs, or of an older epoch than asked: built again.
  await schema.pool.query("UPDATE storefront_listing_price_orders SET computed_at=now()-interval '11 minutes' WHERE epoch=2000");
  assert.equal((await sent(async () => assert.equal((await build(2000, fresh)).total, listed))).builds, 1, "past freshMs");
  assert.equal((await sent(async () => assert.equal((await build(2001, fresh)).head.length, 30))).builds, 1, "a newer epoch");
  // Without freshMs every call builds; after a settled build the next one builds again (no build kept in flight).
  assert.equal((await sent(async () => { await build(2001); await build(2001); })).builds, 2);
  await schema.pool.query("DELETE FROM storefront_listing_price_orders WHERE epoch BETWEEN 2000 AND 2999");
});

test("a slice moves last_sliced_at at most once a minute and leaves the rest of the row alone (#1405)", async t => {
  // A copy of the module: its touch throttle stays apart from the pages' and the clock it saw from theirs.
  const copyName = "touch", copy = await import(`../src/modules/store/listing-price-order.ts?${copyName}`) as typeof priceOrder;
  const key = "test|touch", epoch = 4100;
  assert.ok((await copy.buildPriceOrder(key, epoch, brandRowsSql(), [storefrontCompanies(), "BOSCH"], ascending)).total > 48);
  const row = async () => (await schema.pool.query<{ computed_at: Date; total: number; ids: string[]; sliced: Date | null; sliced_s: number | null }>(
    `SELECT computed_at,total,ids::text[] AS ids,last_sliced_at AS sliced,extract(epoch FROM now()-last_sliced_at)::int AS sliced_s
     FROM storefront_listing_price_orders WHERE epoch=$1`, [epoch])).rows[0];
  const built = await row();
  assert.equal(built.sliced, null, "no slice yet");
  const touchesBy = async (run: () => Promise<unknown>) => {
    let touches = 0;
    await intercepted(text => { if (isTouch(text)) touches++; return undefined; }, async () => { await run(); await copy.sliceTouchesSettled(); });
    return touches;
  };
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  assert.equal(await touchesBy(async () => { await copy.priceOrderSlice(key, 0, 24); await copy.priceOrderSlice(key, 24, 24); }), 1, "two slices: one touch");
  const first = await row();
  assert.equal(first.sliced_s, 0, "moved now");
  t.mock.timers.tick(copy.sliceTouchMs - 1);
  assert.equal(await touchesBy(() => copy.priceOrderSlice(key, 0, 24)), 0, "within the minute: no statement");
  t.mock.timers.tick(1);
  // The process's minute is up, the row's (in SQL) not: the statement is sent and changes nothing, as when another process
  // moved it within the minute.
  assert.equal(await touchesBy(() => copy.priceOrderSlice(key, 0, 24)), 1);
  assert.deepEqual((await row()).sliced, first.sliced, "moved under a minute ago in SQL: kept");
  await schema.pool.query("UPDATE storefront_listing_price_orders SET last_sliced_at=last_sliced_at-interval '2 minutes' WHERE epoch=$1", [epoch]);
  t.mock.timers.tick(copy.sliceTouchMs);
  assert.equal(await touchesBy(() => copy.priceOrderSlice(key, 0, 24)), 1);
  const moved = await row();
  assert.equal(moved.sliced_s, 0, "both minutes up: moved");
  assert.deepEqual([moved.computed_at, moved.total, moved.ids], [built.computed_at, built.total, built.ids], "the order itself unchanged");
  t.mock.timers.tick(copy.sliceTouchMs);
  assert.equal(await touchesBy(async () => assert.equal(await copy.priceOrderSlice("test|touch-none", 0, 24), null)), 0, "no row: no touch");
  await schema.pool.query("DELETE FROM storefront_listing_price_orders WHERE epoch=$1", [epoch]);
});

test("without last_sliced_at (setup not run yet) the first pages' gate is closed and slices do not touch it for five minutes; the stored orders keep working (#1405)", async t => {
  // A copy of the module, so its five-minute switch stays out of the other tests.
  const copyName = "no-column", copy = await import(`../src/modules/store/listing-price-order.ts?${copyName}`) as typeof priceOrder;
  const logged = t.mock.method(console, "error", () => {});
  const key = "test|no-column", epoch = 4200;
  const named: string[] = [];
  // The shared database before setup: every statement naming the column fails as it would there.
  const noColumn = (text: string) => {
    if (!text.includes("last_sliced_at")) return undefined;
    named.push(text);
    return failure("42703");
  };
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  await intercepted(noColumn, async () => {
    const built = await copy.buildPriceOrder(key, epoch, brandRowsSql(), [storefrontCompanies(), "BOSCH"], ascending, { head: 3, freshMs: 10 * 60 * 1000 });
    assert.ok(built.total > 6);
    assert.deepEqual(await copy.priceOrderSlice(key, 0, 3), built.head, "a slice reads the order");
    await copy.sliceTouchesSettled();
    assert.equal(named.length, 1, "its touch failed on the column");
    assert.equal(await copy.priceOrderInUse(key), false);
    assert.equal((await copy.priceOrderSlice(key, 3, 3))?.length, 3);
    t.mock.timers.tick(5 * 60 * 1000 - 1);
    assert.equal(await copy.priceOrderInUse(key), false);
    await copy.sliceTouchesSettled();
    assert.equal(named.length, 1, "no statement names the column within five minutes");
    t.mock.timers.tick(1);
    assert.equal(await copy.priceOrderInUse(key), false);
    assert.equal(named.length, 2, "read again after five minutes, closed again");
    await schema.pool.query("UPDATE storefront_listing_price_orders SET computed_at=now()-interval '11 minutes' WHERE epoch=$1", [epoch]);
    const rebuilt = await sent(async () => assert.equal((await copy.buildPriceOrder(key, epoch, brandRowsSql(), [storefrontCompanies(), "BOSCH"], ascending, { head: 3, freshMs: 10 * 60 * 1000 })).total, built.total));
    assert.equal(rebuilt.builds, 1, "a build still stores");
  });
  assert.equal(copy.priceOrderEnabled(), true, "the stored orders stay on");
  assert.deepEqual(logged.mock.calls.map(call => String(call.arguments[0]).replace(/ \(setup.*/, "")), ["Listing price order: last_sliced_at is missing", "Listing price order: last_sliced_at is missing"],
    "logged once per five minutes");
  await schema.pool.query("DELETE FROM storefront_listing_price_orders WHERE epoch=$1", [epoch]);
});

test("a stored order gone while its size is cached reads the page live", async () => {
  const query = bosch("price-asc", 23), live = await livePage(query);
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  let shown: string[] = [];
  const statements = await sent(async () => { shown = await pageIds(query); });
  assert.deepEqual({ builds: statements.builds, livePages: statements.livePages }, { builds: 0, livePages: 1 });
  assert.deepEqual(shown, live);
});

test("LISTING_PRICE_ORDER=0 never reads the table; a listing over LISTING_PRICE_ORDER_MAX_IDS reads live and stores nothing", async () => {
  await invalidateListings();
  assert.deepEqual(await withEnv({ LISTING_PRICE_ORDER: "0" }, () => sent(async () => {
    for (const sort of ["price-asc", "price-desc"] as const) for (const page of [21, 24]) await pageIds(bosch(sort, page));
  })), { builds: 0, livePages: 4, headPasses: 0, table: 0 });
  await withEnv({ LISTING_PRICE_ORDER_MAX_IDS: "100" }, async () => {
    for (const sort of ["price-asc", "price-desc"] as const) {
      const statements = await sent(async () => assert.deepEqual(await pageIds(bosch(sort, 21)), await livePage(bosch(sort, 21))));
      assert.equal(statements.table, 0);
    }
  });
  assert.deepEqual(await stored(), []);
});

test("brand-filtered, search and model listings store nothing; a make listing stores its order", async () => {
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  const listings: CatalogQuery[] = [{ manufacturer: "bosch", brands: JSON.stringify(["BOSCH"]) }, { q: "bosch" }, { make: "vw", model: "golf-7" }];
  for (const listing of listings) {
    const query = { ...listing, sort: "price-asc" as const, page: "21" };
    const shown = await inRequest(() => catalog.browseProducts(query));
    assert.equal(shown.page, 21, JSON.stringify(listing));
    assert.deepEqual(shown.items.map(card => card.id), await livePage(query), JSON.stringify(listing));
  }
  assert.deepEqual(await stored(), []);
  const make = { make: "vw", sort: "price-desc" as const, page: "22" };
  assert.deepEqual(await pageIds(make), await livePage(make));
  assert.deepEqual((await stored()).map(row => row.total), [rows - 2], "BOSCH without its two hidden rows");
});

test("a make listing's order carries the fits value: the fit sync's bump rebuilds it and not a manufacturer's (#1368)", async () => {
  const fitsValue = async () => (await schema.pool.query<{ fits: number }>("SELECT (epoch+fits_epoch)::int AS fits FROM storefront_listing_epoch")).rows[0].fits;
  const make = { make: "vw", sort: "price-asc" as const, page: "21" }, manufacturer = bosch("price-asc", 21);
  // Both listings reload (an admin edit's bump), with the fits value ahead of the epoch, so the two rows' values differ.
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  await invalidateFits();
  assert.deepEqual(await pageIds(make), await livePage(make));
  assert.deepEqual(await pageIds(manufacturer), await livePage(manufacturer));
  const [epochBefore, fitsBefore] = [await currentEpoch(), await fitsValue()];
  assert.ok(fitsBefore > epochBefore);
  assert.deepEqual((await stored()).map(row => row.epoch), [fitsBefore, epochBefore], "the make's row, then the manufacturer's");
  await invalidateFits();
  const rebuilt = await sent(async () => assert.deepEqual(await pageIds(make), await livePage(make)));
  const kept = await sent(async () => assert.deepEqual(await pageIds(manufacturer), await livePage(manufacturer)));
  assert.deepEqual([rebuilt.builds, kept.builds], [1, 0]);
  assert.deepEqual((await stored()).map(row => row.epoch), [fitsBefore + 1, epochBefore]);
  // A build under the epoch alone (a task still on the code before #1368) never replaces the make's newer row.
  const { rows: [row] } = await schema.pool.query<{ key_hash: string; total: number }>("SELECT key_hash,total FROM storefront_listing_price_orders WHERE epoch=$1", [fitsBefore + 1]);
  const pricedSql = `SELECT catalog.id,catalog.unavailable,catalog.price_kurus FROM (${catalog.storefrontCatalogSql}) catalog WHERE catalog.display_brand=$2`;
  assert.deepEqual((await schema.pool.query(priceOrder.priceOrderBuildSql(pricedSql, "unavailable,price_kurus ASC NULLS LAST,id", "$3", "$4", "$5", "$6"),
    [storefrontCompanies(), "MAHLE", row.key_hash, epochBefore, 1000, 3])).rows, [], "nothing stored");
  assert.deepEqual((await schema.pool.query("SELECT epoch::int,total FROM storefront_listing_price_orders WHERE key_hash=$1", [row.key_hash])).rows,
    [{ epoch: fitsBefore + 1, total: row.total }]);
});

test("boundedQuery writes with write: true; a plain one stays read only", async () => {
  const { boundedQuery } = await import("../src/lib/db");
  await schema.pool.query("CREATE TABLE bounded_write_probe(n int)");
  assert.deepEqual((await boundedQuery<{ n: number }>("test.write", "INSERT INTO bounded_write_probe VALUES(1) RETURNING n", [], 5_000, { write: true })).rows, [{ n: 1 }]);
  await assert.rejects(boundedQuery("test.readOnly", "INSERT INTO bounded_write_probe VALUES(2)", []), { code: "25006" });
  assert.deepEqual((await schema.pool.query("SELECT n FROM bounded_write_probe")).rows, [{ n: 1 }]);
});

test("LISTING_PRICE_ORDER_MAX_IDS is at most the integer columns' 2^31-1", () => withEnv({ LISTING_PRICE_ORDER_MAX_IDS: "9000000000" }, async () => {
  assert.equal(priceOrder.priceOrderMaxIds(), 2_147_483_647);
}));

// The tests from here on move the clock (Date only) ten minutes and more ahead. This process's polled listing epoch then
// stays as it last read it until the real clock catches up; the tests after the first move it through invalidateListings()
// only. This one moves it over an hour, one cache TTL a cycle, in another process whose caches nothing else reads.
test("with page 1 and a deep page hot, each refresh prices the listing once and pages 20 and 21 read one order; once the deep traffic stops, page 1 prices its own ids (#1405)", async t => {
  const sort = "price-asc", ttlMs = 10 * 60 * 1000, step = ttlMs + 1000;
  const proc = await otherProcess("cycles");
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await schema.pool.query("DELETE FROM storefront_listing_cache WHERE namespace='page-ids'");
  await invalidateListings();
  // A slice touched the order within the last minute in this process (earlier tests): that minute is over first.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + priceOrder.sliceTouchMs });
  /** One cache TTL and a second: the process clock moves, and so does every stored row's age (computed_at, the last slice). */
  const advance = async () => {
    await priceOrder.sliceTouchesSettled();
    t.mock.timers.tick(step);
    await schema.pool.query(`UPDATE storefront_listing_price_orders SET computed_at=computed_at-$1::bigint*interval '1 millisecond',
      last_sliced_at=last_sliced_at-$1::bigint*interval '1 millisecond'`, [step]);
    await schema.pool.query("UPDATE storefront_listing_cache SET computed_at=computed_at-$1::bigint*interval '1 millisecond' WHERE namespace='page-ids'", [step]);
  };
  // A card of page 20 made the dearest: every later card moves up a place, so pages 20 and 21 both change.
  const originals = new Map<string, unknown>();
  let raised = 0;
  const reprice = async (current: string[]) => {
    const id = current[470];
    const { rows: [row] } = await schema.pool.query<{ price_data: unknown }>("SELECT price_data FROM supplier_items WHERE id=$1", [id]);
    if (!originals.has(id)) originals.set(id, row.price_data);
    await schema.pool.query("UPDATE supplier_items SET price_data=jsonb_build_object('nf',$2::int) WHERE id=$1", [id, 10_000 + ++raised]);
    const next = await liveOrder(sort);
    assert.ok(!same(pageOf(next, 20), pageOf(current, 20)) && !same(pageOf(next, 21), pageOf(current, 21)), "pages 20 and 21 change");
    return next;
  };
  /** Pages 20 and 21 of `proc` once they show `order` (the refreshes run in the background), then every load is done. */
  const settled = async (order: string[], label: string) => {
    const shown = await until(async () => [await pageIds(bosch(sort, 20), proc), await pageIds(bosch(sort, 21), proc)],
      pair => same(pair, [pageOf(order, 20), pageOf(order, 21)]));
    assert.deepEqual(shown, [pageOf(order, 20), pageOf(order, 21)], `${label}: pages 20 and 21 from the current order`);
    assert.deepEqual(shown[0].filter(id => shown[1].includes(id)), [], `${label}: no card on both`);
    await quiet();
  };
  const counts = ({ builds, headPasses, livePages }: Awaited<ReturnType<typeof sent>>) => ({ builds, headPasses, livePages });
  const page = (number: number) => pageIds(bosch(sort, number), proc);
  try {
    let order = await liveOrder(sort);
    // Cold: the deep page builds, page 1 takes the order's first ids.
    assert.deepEqual(counts(await sent(async () => { await page(21); await page(1); await settled(order, "cold"); })), { builds: 1, headPasses: 0, livePages: 0 }, "cold");
    const cycles: [string, () => Promise<unknown>][] = [
      ["page 1 first", async () => { await page(1); await page(21); }],
      ["page 21 first", async () => { await page(21); await page(1); }],
      ["both at once", () => Promise.all([page(1), page(21)])],
    ];
    for (const [label, read] of cycles) {
      order = await reprice(order);
      await advance();
      assert.deepEqual(counts(await sent(async () => { await read(); await settled(order, label); })), { builds: 1, headPasses: 0, livePages: 0 }, label);
    }
    // The deep traffic stops. Its last slice is one TTL old at the next refresh (the gate open: page 1 rebuilds the order
    // once more), two at the one after (closed): from then on page 1 prices its own 480 ids and the order is not rebuilt.
    const firstPages = async (label: string) => {
      order = await reprice(order);
      await advance();
      return counts(await sent(async () => {
        await page(1);
        const shown = await until(() => page(20), ids => same(ids, pageOf(order, 20)));
        assert.deepEqual(shown, pageOf(order, 20), label);
        await quiet();
      }));
    };
    assert.deepEqual(await firstPages("page 1 alone, one TTL after the last slice"), { builds: 1, headPasses: 0, livePages: 0 }, "1 TTL: one more build");
    const builtAge = (await stored())[0].age_s;
    for (const ttls of [2, 3]) {
      assert.deepEqual(await firstPages(`page 1 alone, ${ttls} TTLs after the last slice`), { builds: 0, headPasses: 1, livePages: 0 }, `${ttls} TTLs`);
      assert.ok((await stored())[0].age_s >= builtAge + (ttls - 1) * 600, `${ttls} TTLs: the stored order is not rebuilt`);
    }
    // A deep page again: its stale order is sliced at once (and touched), then rebuilt; page 1 rebuilds it at its next refresh.
    assert.deepEqual(counts(await sent(async () => {
      await page(21);
      assert.deepEqual(await until(() => page(21), ids => same(ids, pageOf(order, 21))), pageOf(order, 21), "the deep page's rebuild");
      await quiet();
    })), { builds: 1, headPasses: 0, livePages: 0 }, "a deep page again");
    assert.deepEqual(await firstPages("page 1 after a deep page"), { builds: 1, headPasses: 0, livePages: 0 }, "page 1 after a deep page");
    // The deep page's own refresh (due too) takes the order page 1 built.
    assert.deepEqual(counts(await sent(async () => {
      assert.deepEqual(await page(21), pageOf(order, 21), "page 21 from the order page 1 built");
      await quiet();
    })), { builds: 0, headPasses: 0, livePages: 0 }, "the deep page's refresh");
  } finally {
    for (const [id, priceData] of originals) await schema.pool.query("UPDATE supplier_items SET price_data=$2 WHERE id=$1", [id, priceData]);
    await priceOrder.sliceTouchesSettled();
    await schema.pool.query("TRUNCATE storefront_listing_price_orders");
    await invalidateListings();
  }
});

test("a failed build reads the page live, builds no more for ten minutes, then stores the order", async t => {
  const query = bosch("price-asc", 21), next = bosch("price-asc", 22);
  const [live, liveNext] = [await livePage(query), await livePage(next)];
  const logged = t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  // A statement timeout (the build's 30 s limit) and any other error.
  for (const code of ["57014", "53200"]) {
    await schema.pool.query("TRUNCATE storefront_listing_price_orders");
    // Another process: its process cache is empty, so the listing's first deep page builds.
    const other = await otherProcess(`failing${code}`);
    let builds = 0;
    const failBuild = (text: string) => {
      if (!text.includes("INSERT INTO storefront_listing_price_orders")) return undefined;
      builds++;
      return Object.assign(new Error(`simulated ${code}`), { code });
    };
    await intercepted(failBuild, async () => {
      assert.deepEqual(await pageIds(query, other), live, `${code}: the live page`);
      // Epoch reloads within the back-off read live too, without a build.
      await invalidateListings();
      assert.deepEqual(await pageIds(next, other), liveNext);
      t.mock.timers.tick(priceOrder.failedBuildBackoffMs - 1);
      await invalidateListings();
      assert.deepEqual(await pageIds(query, other), live);
    });
    assert.equal(builds, 1, `${code}: one build within the back-off`);
    assert.deepEqual(await stored(), []);
    t.mock.timers.tick(1);
    await invalidateListings();
    const after = await sent(async () => assert.deepEqual(await pageIds(next, other), liveNext));
    assert.deepEqual({ builds: after.builds, livePages: after.livePages }, { builds: 1, livePages: 0 }, `${code}: stored after the back-off`);
    assert.equal((await stored()).length, 1);
  }
  const messages = logged.mock.calls.map(call => String(call.arguments[0]));
  assert.ok(messages.some(message => message.startsWith("Listing price order: build failed (57014)")));
  assert.ok(messages.some(message => message.startsWith("Listing price order: build failed (53200)")));
});

// After the failed builds above: the price-desc listing, whose builds they left alone. Its failure keeps it from building
// for ten real minutes, which the last test does not need.
test("a failing build started by the first pages shows their own 480 ids and starts no other within the back-off (#1405)", async t => {
  const sort = "price-desc", order = await liveOrder(sort), reversed = [...order].reverse();
  t.mock.method(console, "error", () => {});
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  assert.deepEqual(await pageIds(bosch(sort, 21), await otherProcess("backoff-deep")), pageOf(order, 21));
  await setOrder(reversed, await currentEpoch(), "11 minutes", "1 minute");
  const heads = await otherProcess("backoff-heads");
  let builds = 0;
  const failBuild = (text: string) => {
    if (!text.includes("INSERT INTO storefront_listing_price_orders")) return undefined;
    builds++;
    return failure("57014");
  };
  let statements: Awaited<ReturnType<typeof sent>> | undefined;
  await intercepted(failBuild, async () => {
    statements = await sent(async () => {
      assert.deepEqual(await pageIds(bosch(sort, 1), heads), pageOf(reversed, 1), "11 minutes old: served at once");
      assert.deepEqual(await until(() => pageIds(bosch(sort, 1), heads), ids => same(ids, pageOf(order, 1))), pageOf(order, 1), "then the 480-id pass's");
      // An epoch reload within the back-off: the gate is still open, the build is not tried.
      await invalidateListings();
      assert.deepEqual(await pageIds(bosch(sort, 20), heads), pageOf(order, 20), "the reload's 480-id pass");
      await quiet();
    });
  });
  assert.equal(builds, 1, "one build tried");
  assert.equal(statements?.headPasses, 2, "a pass on the refresh and on the reload");
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
});

// Last: a missing table turns the stored orders off for five minutes in this process.
test("a missing table reads deep pages live and logs once", async t => {
  // The isolated search_path ends in public, so a dropped table would fall through to a shared public table (#1321). Take
  // public off every connection the app pool can open before the drop: all of them exist and are pinned.
  const { db } = await import("../src/lib/db");
  const settled = await Promise.allSettled(Array.from({ length: db.options.max ?? 10 }, () => db.connect()));
  const held = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  try {
    const failure = settled.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
    for (const client of held) await client.query(`SET search_path TO ${schema.name}`);
  } finally { for (const client of held) client.release(); }
  const query = bosch("price-asc", 22), live = await livePage(query);
  await pageIds(bosch("price-desc", 22));
  await schema.pool.query("DROP TABLE storefront_listing_price_orders");
  const logged = t.mock.method(console, "error", () => {});
  assert.deepEqual(await pageIds(query), live);
  assert.deepEqual(await pageIds(bosch("price-desc", 23)), await livePage(bosch("price-desc", 23)));
  assert.equal(logged.mock.callCount(), 1);
  assert.match(String(logged.mock.calls[0].arguments[0]), /storefront_listing_price_orders is missing/);
  assert.equal(priceOrder.priceOrderEnabled(), false);
});
