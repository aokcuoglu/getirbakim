import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import pg from "pg";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

// The cached order of a search in an isolated copy of the schema: every page of a search sorted by price (#1425), by
// relevance with a filter, or newest (#1440) slices one order kept in memory (SEARCH_PRICE_ORDER=0 / SEARCH_RANK_ORDER=0
// read the live count and page again), with the ids, total, pages and notes of the live path, under the epoch, TTL,
// failure and budget rules of the search caches.
// Nothing is written to the shared database's tables.
type Catalog = typeof import("../src/modules/store/catalog");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: Catalog;
let invalidateListings: () => Promise<void>, invalidateFits: () => Promise<void>;
let closeDb: () => Promise<void>;
const [basbug] = storefrontCompanies();
const ids: string[] = [];

// The category tree (getStoreCategories) calls connection(), which needs a request scope: a static work store lets it
// run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the other imports).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);

/** Another app process: a second copy of the catalog module, with its own process caches, on the same database and epoch. */
const otherProcess = async (name: string) => await import(`../src/modules/store/catalog.ts?${name}`) as Catalog;
/** Polls `read` until `done` holds or the deadline passes (loads finish in the background). */
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
 * statement without sending it: a promise-style call (boundedQuery's) rejects with it, a callback-style one (Pool.query's)
 * has its callback called with it.
 */
async function intercepted(onText: (text: string) => Error | undefined, run: () => Promise<unknown>) {
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
const isOrder = (text: string) => text.includes("SELECT ids::text AS ids FROM ordered");
/** What `run` sends on any connection, by kind: the order statement, live price pages, counts, and every statement. */
async function sent(run: () => Promise<unknown>) {
  const texts: string[] = [];
  await intercepted(text => { texts.push(text); return undefined; }, run);
  return {
    texts,
    orders: texts.filter(isOrder).length,
    livePages: texts.filter(text => /ORDER BY unavailable,price_kurus (ASC|DESC) NULLS LAST,id LIMIT \d+ OFFSET/.test(text)).length,
    rankPages: texts.filter(text => /rank DESC,[\s\S]* LIMIT \d+ OFFSET/.test(text)).length,
    hits: texts.filter(text => text.startsWith("WITH main AS MATERIALIZED")).length,
    counts: texts.filter(text => /^SELECT count\(\*\)/.test(text)).length,
    offsets: texts.filter(text => /\bOFFSET\b/.test(text)).length,
  };
}
const failure = (code: string) => Object.assign(new Error(`simulated ${code}`), { code });

const vw = { vehicleTypeId: "340" };
type Result = Awaited<ReturnType<Catalog["browseProducts"]>>;
const browse = (query: CatalogQuery, context: { vehicleTypeId?: string } = {}, from: Catalog = catalog, options?: { limit?: number }): Promise<Result> =>
  inRequest(() => from.browseProducts(query, context, options));
/** `run` with every listing read waiting for its reload (LISTING_EPOCH_WAIT_MS, 250 ms by default): after a bump a slow reload would return the earlier value. */
const patient = <T>(run: () => Promise<T>) => withEnv({ LISTING_EPOCH_WAIT_MS: "60000" }, run);
const live = <T>(run: () => Promise<T>) => withEnv({ SEARCH_PRICE_ORDER: "0", SEARCH_RANK_ORDER: "0" }, run);

before(async () => {
  schema = await isolatedSchema("search_price_order_test");
  const brandNames = ["BOSCH", "TRW", "FEBI", "MANN"];
  for (const name of brandNames) {
    const { rows: [brand] } = await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES($1,$1) RETURNING id::text", [name]);
    await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES('basbug',$1,$2,24)", [name, brand.id]);
  }
  // 96 rows: three in four brake pads, the rest filters; costs 40-239, shared by two or three rows (ties by id); every
  // 17th dropped by its supplier (unavailable, no price); every third in the "fren" category.
  for (let n = 1; n <= 96; n++) {
    const brand = brandNames[n % 4], name = n % 4 === 0 ? "FILTRE" : "FREN BALATASI";
    const { rows: [row] } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('basbug',$1,'G','MRK',$2,$3,$4,$5,1,1,1,$6,now()-interval '30 days',now(),now()) RETURNING id::text`,
    [basbug, `${brand.slice(0, 3)} P${1000 + n}`, { uk: brand, ac: `${brand} ${name} P${n}`, ac2: "", dc: "TL", ...(n % 3 === 0 ? { category: "fren" } : {}) },
      { nf: 40 + (n * 37) % 200 }, { stok: n % 5 === 0 ? 0 : 2 }, n % 17 === 0 ? "inactive" : "present"]);
    ids.push(row.id);
  }
  // Rank ties: six groups of 16 rows share one updated_at, so the ranked order falls to the updated_at and id tie-breaks.
  await schema.pool.query("UPDATE supplier_items SET changed_at=timestamptz '2026-01-01' + (right(code,2)::int % 6) * interval '1 day'");
  // Two rows rank away from the rest in the distinct-rank specs (the renamed row ids[0] ranks last for "fren balatasi", the
  // row ids[9] first for the code "P10"); their dates sit outside the groups, ids[0] newest and ids[9] oldest, so the newest
  // order cannot coincide with the relevance order whatever the random uuids tie-break to.
  await schema.pool.query("UPDATE supplier_items SET changed_at=CASE id WHEN $1 THEN timestamptz '2026-02-01' ELSE timestamptz '2025-12-01' END WHERE id=ANY($2::uuid[])", [ids[0], [ids[0], ids[9]]]);
  await schema.pool.query("SELECT refresh_product_matches()");
  // An admin-renamed row ranks from its computed name, not the stored rank.
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,name) VALUES($1,$1,'SPORT FREN BALATA ÖZEL')", [ids[0]]);
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF VII (5G1)','2012-08-01','2017-03-01');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
     VALUES(340,10,'1.6 TDI',1598,'Diesel','Dizel',110,81,'2012-08-01','golf');
    INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT 1,id FROM supplier_items WHERE code ~ '[02468]$';
    INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode)
     SELECT ps.product_id,340,'add' FROM product_sources ps JOIN supplier_items s ON s.id=ps.supplier_item_id WHERE s.code ~ '[0-5]$'`);
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
    ('trodo',3,NULL,'Yedek parçalar','yedek-parca','{3}','','{}'),('trodo',252,3,'Fren','fren','{3,252}','','{}');
    INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
    ('trodo',3,'tr','Yedek parçalar','yedek-parca'),('trodo',252,'tr','Fren','fren')`);
  await schema.pool.query("INSERT INTO search_vocabulary(scope,word,frequency) VALUES('product','fren',100),('product','balatasi',100),('product','filtre',50)");
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, catalogModule, epoch] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"), import("../src/modules/store/listing-epoch")]);
  catalog = catalogModule;
  invalidateListings = epoch.invalidateListings;
  invalidateFits = epoch.invalidateFits;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

/**
 * Runs `run` with the order statement held back until `release` is called (a slow load): every other statement goes on.
 */
async function held(run: (release: () => void) => Promise<unknown>) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "";
    const call = () => (original as (...rest: unknown[]) => unknown).apply(this, args);
    return isOrder(text) ? gate.then(call) : call();
  } as typeof original;
  try {
    await run(release);
  } finally {
    release();
    pg.Client.prototype.query = original;
  }
}
/**
 * The card reads of one page: the rows by id and their grouped offers, and the cache epoch poll (listing-epoch.ts reads the
 * shared counter when the last read is over a second old, so a page slowed by load may send one). Nothing else belongs to a warm page.
 */
const isCardRead = (text: string) => text.startsWith("SELECT epoch::text AS epoch") || text.startsWith("SELECT * FROM (SELECT * FROM storefront_catalog") || text.includes("FROM product_offers o WHERE o.primary_id=ANY");
const asc = "price-asc" as const, desc = "price-desc" as const;
const priceOf = async (id: string) => (await schema.pool.query<{ price_data: { nf: number } }>("SELECT price_data FROM supplier_items WHERE id=$1", [id])).rows[0].price_data;
// An upsert: the fixture's renamed row is an override too, and keeps its name.
const hide = (id: string) => schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true) ON CONFLICT (supplier_item_id) DO UPDATE SET hidden=true", [id]);
const unhide = (id: string) => schema.pool.query("UPDATE commerce_item_overrides SET hidden=false WHERE supplier_item_id=$1", [id]);

type Spec = [string, CatalogQuery, { vehicleTypeId?: string }?];
const specs: Spec[] = [
  ["one word", { q: "fren" }],
  ["two words, a vehicle reading", { q: "bosch golf" }],
  ["code search", { q: "P10", searchBy: "code" }],
  ["misspelt, corrected", { q: "frenx" }],
  ["too short", { q: "f" }],
  ["no hit", { q: "zzzyyy" }],
  ["brand", { q: "fren", brands: JSON.stringify(["TRW"]) }],
  ["in stock", { q: "fren", availability: "in_stock" }],
  ["out of stock", { q: "fren", availability: "out_of_stock" }],
  ["supplied", { q: "fren", availability: "supplied" }],
  ["category (two id sets)", { q: "fren", category: "fren" }],
  ["make (two id sets)", { q: "fren", make: "vw" }],
  ["the garage vehicle's fits", { q: "fren", fits: "vehicle" }, vw],
  ["category and make (three id sets)", { q: "fren", category: "fren", make: "vw" }],
  ["a property (attributes)", { q: "fren", attributes: JSON.stringify({ "Fitting Position": ["Front Axle"] }) }],
];
const shape = (result: Result) => ({ ids: result.items.map(item => item.id), total: result.total, page: result.page, pages: result.pages, pageSize: result.pageSize,
  correctedQuery: (result as { correctedQuery?: string }).correctedQuery, vehicleScope: (result as { vehicleScope?: unknown }).vehicleScope,
  searchTooShort: (result as { searchTooShort?: boolean }).searchTooShort });

test("every page of both price orders of every search kind is the live page: ids, total, page, pages and notes", async () => {
  const proc = await otherProcess("oracle");
  let keysWithHits = 0, orders = 0;
  for (const [label, base, context = {}] of specs) {
    for (const sort of [asc, desc]) {
      let hits = 0;
      for (const page of [undefined, "1", "2", "3", "4", "99", "0", "x"]) {
        const query = { ...base, sort, page };
        let cached: ReturnType<typeof shape> | undefined;
        orders += (await sent(async () => { cached = shape(await browse(query, context, proc)); })).orders;
        const expected = shape(await live(() => browse(query, context)));
        assert.deepEqual(cached, expected, `${label} ${sort} page ${page}`);
        hits = expected.total;
      }
      if (hits > 0) keysWithHits++;
    }
  }
  assert.equal(orders, keysWithHits, "one order statement per search, filters and sort that lists something, none for the empty ones");
  assert.ok(keysWithHits >= 20);
  // The notes the search reads carry over.
  assert.equal(shape(await browse({ q: "frenx", sort: asc }, {}, proc)).correctedQuery, "fren");
  assert.equal(shape(await browse({ q: "f", sort: asc }, {}, proc)).searchTooShort, true);
  assert.deepEqual(shape(await browse({ q: "bosch golf", sort: asc }, {}, proc)).vehicleScope, { productText: "bosch", vehicleText: "golf", fitted: false });
  // The order is the price order: saleable cards by price (ties by id), those nobody supplies last.
  const all = (await Promise.all([1, 2, 3].map(page => browse({ q: "fren", sort: asc, page: String(page) }, {}, proc)))).flatMap(result => result.items);
  assert.equal(all.length, 72);
  const saleable = all.filter(card => !card.unavailable);
  assert.ok(all.slice(saleable.length).every(card => card.unavailable) && saleable.length < all.length && saleable.length > 50);
  for (let index = 1; index < saleable.length; index++) {
    const [previous, card] = [saleable[index - 1], saleable[index]];
    assert.ok(card.price_kurus! > previous.price_kurus! || (card.price_kurus === previous.price_kurus && previous.id < card.id), `ascending: ${index}`);
  }
});

test("the vehicle lead's limit takes the first cards of the same order, the page's total and pages stay", async () => {
  const proc = await otherProcess("limit");
  for (const sort of [asc, desc]) for (const limit of [1, 4, 24, 100]) {
    const query = { q: "fren", fits: "vehicle", sort, page: "1" } as const;
    const cached = shape(await browse(query, vw, proc, { limit }));
    assert.deepEqual(cached, shape(await live(() => browse(query, vw, catalog, { limit }))), `${sort} limit ${limit}`);
    assert.equal(cached.ids.length, Math.min(limit, 24));
    assert.equal(cached.total, 42);
  }
});

test("a warm page sends only its card reads: no hit read, no count, no OFFSET page, no order; each sort is its own order", async () => {
  const proc = await otherProcess("warm");
  const cold = await sent(() => browse({ q: "fren", sort: asc, page: "1" }, {}, proc));
  assert.deepEqual({ orders: cold.orders, hits: cold.hits, livePages: cold.livePages, counts: cold.counts }, { orders: 1, hits: 1, livePages: 0, counts: 0 }, "the cold page: the hits and one order");
  for (const page of ["2", "3", "1"]) {
    const warm = await sent(() => browse({ q: "fren", sort: asc, page }, {}, proc));
    assert.deepEqual({ orders: warm.orders, hits: warm.hits, livePages: warm.livePages, counts: warm.counts, offsets: warm.offsets }, { orders: 0, hits: 0, livePages: 0, counts: 0, offsets: 0 }, `page ${page}`);
    assert.ok(warm.texts.length > 0 && warm.texts.every(isCardRead), `page ${page}: ${warm.texts.filter(text => !isCardRead(text)).join(" | ")}`);
  }
  const descending = await sent(() => browse({ q: "fren", sort: desc, page: "2" }, {}, proc));
  assert.equal(descending.orders, 1, "price-desc is another key");
  assert.equal((await sent(() => browse({ q: "fren", sort: desc, page: "3" }, {}, proc))).orders, 0);
  assert.equal((await sent(() => browse({ q: "fren", sort: asc, page: "3" }, {}, proc))).orders, 0, "and price-asc is still kept");
  // Another search, another filter: other keys.
  assert.equal((await sent(() => browse({ q: "filtre", sort: asc }, {}, proc))).orders, 1);
  assert.equal((await sent(() => browse({ q: "fren", sort: asc, availability: "in_stock" }, {}, proc))).orders, 1);
  assert.equal((await sent(() => browse({ q: "P10", sort: asc }, {}, proc))).orders, 1);
  assert.equal((await sent(() => browse({ q: "P10", sort: asc, searchBy: "code" }, {}, proc))).orders, 1, "a code search is its own key");
});

test("an epoch bump reloads every key; the fit sync's bump only the searches and filters that read vehicle fits", () => patient(async () => {
  const proc = await otherProcess("epochs");
  const keys: [string, CatalogQuery, boolean][] = [
    ["one word", { q: "fren", sort: asc }, false],
    ["code search", { q: "P10", searchBy: "code", sort: asc }, false],
    ["category", { q: "fren", category: "fren", sort: asc }, false],
    ["two words", { q: "bosch golf", sort: asc }, true],
    ["make filter", { q: "fren", make: "vw", sort: asc }, true],
    ["the garage vehicle's filter", { q: "fren", fits: "vehicle", sort: asc }, true],
  ];
  const context = (query: CatalogQuery) => query.fits ? vw : {};
  const read = async (query: CatalogQuery) => (await sent(() => browse(query, context(query), proc))).orders;
  for (const [label, query] of keys) assert.equal(await read(query), 1, `${label}: loaded`);
  for (const [label, query] of keys) assert.equal(await read(query), 0, `${label}: kept`);
  await invalidateFits();
  for (const [label, query, fits] of keys) assert.equal(await read(query), fits ? 1 : 0, `${label}: after the fit sync's bump`);
  await invalidateListings();
  for (const [label, query] of keys) assert.equal(await read(query), 1, `${label}: after an admin edit's bump`);
  for (const [label, query] of keys) assert.equal(await read(query), 0, `${label}: kept again`);
}));

test("an admin hiding a product removes it from the order after the bump", () => patient(async () => {
  const proc = await otherProcess("hide");
  const query: CatalogQuery = { q: "fren", sort: asc };
  const before = shape(await browse(query, {}, proc));
  const hidden = before.ids[3];
  await hide(hidden);
  try {
    await invalidateListings();
    const after = shape(await browse(query, {}, proc));
    assert.equal(after.total, before.total - 1);
    assert.ok(!after.ids.includes(hidden));
    assert.deepEqual(after, shape(await live(() => browse(query, {}))));
  } finally {
    await unhide(hidden);
    await invalidateListings();
  }
}));

test("after a bump with a slow load the earlier order is served within the wait, then the new one; an empty earlier value never is", async () => {
  await withEnv({ LISTING_EPOCH_WAIT_MS: "50" }, async () => {
    const proc = await otherProcess("slow");
    const query: CatalogQuery = { q: "fren", sort: asc };
    const earlier = shape(await browse(query, {}, proc)), hidden = earlier.ids[3];
    await hide(hidden);
    try {
      await held(async release => {
        await invalidateListings();
        const served = shape(await browse(query, {}, proc));
        assert.deepEqual(served.ids, earlier.ids.filter(id => id !== hidden), "the earlier order, the hidden card left out");
        assert.equal(served.total, earlier.total, "and its total");
        release();
        const current = shape(await live(() => browse(query, {})));
        assert.deepEqual((await until(async () => shape(await browse(query, {}, proc)), found => found.total === current.total)), current);
      });
    } finally {
      await unhide(hidden);
      await invalidateListings();
    }
    // An empty order is no earlier value: a search that just gained its first product waits for the reload.
    const empty: CatalogQuery = { q: "qqqwww", sort: asc };
    assert.equal((await browse(empty, {}, proc)).total, 0);
    const { rows: [added] } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('basbug',$1,'G','MRK','QQQ P2000','{"uk":"BOSCH","ac":"BOSCH QQQWWW","ac2":"","dc":"TL"}','{"nf":10}','{"stok":2}',1,1,1,'present',now(),now(),now()) RETURNING id::text`, [basbug]);
    try {
      await held(async release => {
        await invalidateListings();
        const timer = setTimeout(release, 300);
        const found = await browse(empty, {}, proc);
        clearTimeout(timer);
        assert.deepEqual([found.total, found.items.map(item => item.id)], [1, [added.id]], "waited for the reload instead of showing no products");
      });
    } finally {
      await schema.pool.query("DELETE FROM supplier_items WHERE id=$1", [added.id]);
      await invalidateListings();
    }
  });
});

test("a price change without a bump keeps the position and shows the new price; past the TTL one background load moves the order", async t => {
  // The mocked clock runs from the first read, so the order is stamped by it and the ticks below are exact.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const proc = await otherProcess("fresh");
  const query: CatalogQuery = { q: "fren", sort: asc };
  const first = await browse(query, {}, proc), earlier = shape(first), moved = earlier.ids[10];
  const original = await priceOf(moved), earlierPrice = first.items.find(item => item.id === moved)!.price_kurus;
  await schema.pool.query("UPDATE supplier_items SET price_data='{\"nf\":1}' WHERE id=$1", [moved]);
  try {
    const current = await browse(query, {}, proc);
    assert.deepEqual(current.items.map(item => item.id), earlier.ids, "the position is the cached one");
    const card = current.items.find(item => item.id === moved)!;
    const fresh = (await schema.pool.query<{ price_kurus: number }>("SELECT price_kurus FROM storefront_catalog WHERE id=$1", [moved])).rows[0].price_kurus;
    assert.equal(card.price_kurus, fresh, "the card is read live");
    assert.notEqual(fresh, earlierPrice, "the price did change");
    t.mock.timers.tick(10 * 60 * 1000 - 1);
    assert.equal((await sent(() => browse(query, {}, proc))).orders, 0, "within the TTL");
    t.mock.timers.tick(2);
    let ids: string[] = [];
    const reload = await sent(async () => {
      assert.deepEqual((await browse(query, {}, proc)).items.map(item => item.id), earlier.ids, "the stale order is served at once");
      ids = (await until(async () => (await browse(query, {}, proc)).items.map(item => item.id), found => found[0] === moved)) as string[];
    });
    assert.equal(reload.orders, 1, "one background load");
    assert.equal(ids[0], moved, "the order then moves");
    assert.deepEqual(shape(await browse(query, {}, proc)), shape(await live(() => browse(query, {}))));
  } finally {
    await schema.pool.query("UPDATE supplier_items SET price_data=$2 WHERE id=$1", [moved, original]);
  }
});

test("a failed first order statement reads that request live and holds the key: an hour after a timeout (57014), ten minutes after any other error", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const minute = 60 * 1000;
  for (const [code, holdMs] of [["57014", 60 * minute], ["53200", 10 * minute]] as const) {
    const proc = await otherProcess(`failing${code}`);
    const query: CatalogQuery = { q: "fren", sort: asc }, next: CatalogQuery = { ...query, page: "2" };
    const expected = [shape(await live(() => browse(query, {}))).ids, shape(await live(() => browse(next, {}))).ids];
    let attempts = 0, failing = true;
    await intercepted(text => {
      if (!isOrder(text)) return undefined;
      attempts++;
      return failing ? failure(code) : undefined;
    }, async () => {
      assert.deepEqual(shape(await browse(query, {}, proc)).ids, expected[0], `${code}: the live page`);
      assert.equal(attempts, 1);
      assert.deepEqual(shape(await browse(next, {}, proc)).ids, expected[1], `${code}: the next page is live too`);
      t.mock.timers.tick(holdMs - 1);
      await browse(query, {}, proc);
      assert.equal(attempts, 1, `${code}: no order statement within the hold`);
      failing = false;
      t.mock.timers.tick(1);
      assert.deepEqual(shape(await browse(next, {}, proc)).ids, expected[1]);
      assert.equal(attempts, 2, `${code}: one again after the hold`);
    });
    assert.equal((await sent(() => browse(query, {}, proc))).orders, 0, `${code}: the order is kept now`);
    // Another key of the same search was not held.
    t.mock.timers.tick(0);
  }
});

test("a key that loaded, then failed to reload (epoch bump or TTL), reads live during the hold without error logs per request, not the earlier order", async t => {
  const logged = t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const minute = 60 * 1000;
  for (const [reason, reload] of [["an epoch bump", async () => { await invalidateListings(); }], ["the TTL", async () => { t.mock.timers.tick(10 * minute + 1); }]] as const) {
    const proc = await otherProcess(`reload-fails-${reason.replace(/ /g, "-")}`);
    const query: CatalogQuery = { q: "fren", sort: asc }, next: CatalogQuery = { ...query, page: "2" };
    const earlier = shape(await browse(query, {}, proc));
    const hidden = earlier.ids[3];
    await hide(hidden);
    try {
      const expected = [shape(await live(() => browse(query, {}))), shape(await live(() => browse(next, {})))];
      assert.equal(expected[0].total, earlier.total - 1);
      let attempts = 0, failing = true;
      logged.mock.resetCalls();
      await intercepted(text => {
        if (!isOrder(text)) return undefined;
        attempts++;
        return failing ? failure("57014") : undefined;
      }, async () => {
        await reload();
        // The request whose reload fails may still get the earlier entry; the hold is set by then.
        await browse(query, {}, proc);
        await until(async () => attempts, found => found >= 1);
        // The hold is set just before the build's log line, and staleCache logs the failed reload or refresh after it:
        // wait for both lines instead of a fixed sleep, so a loaded runner cannot read before the hold is in place.
        const logs = () => logged.mock.calls.map(call => String(call.arguments[0]));
        await until(async () => logs(), lines => lines.some(line => line.includes("build failed")) && lines.some(line => /^Stale cache re(load|fresh) failed/.test(line)));
        const errorsAfterFailure = logged.mock.callCount();
        assert.equal(attempts, 1, `${reason}: one failed statement`);
        for (const [page, index] of [["1", 0], ["2", 1], ["1", 0]] as const) {
          const read = await sent(async () => assert.deepEqual(shape(await browse({ ...query, page }, {}, proc)), expected[index], `${reason}: page ${page} is live`));
          assert.ok(read.livePages >= 1 && read.orders === 0, `${reason}: live page, no order statement`);
        }
        assert.equal(attempts, 1, `${reason}: no order statement within the hold`);
        assert.equal(logged.mock.callCount(), errorsAfterFailure, `${reason}: no error log per request in the hold`);
        assert.ok(errorsAfterFailure <= 3, `${reason}: the failure itself logs once each by the database timeout, the build and the cache`);
        failing = false;
        t.mock.timers.tick(60 * minute);
        await until(async () => (await browse(query, {}, proc)).total, total => total === expected[0].total);
        assert.ok(attempts >= 2, `${reason}: an order statement again after the hold`);
      });
      assert.deepEqual(shape(await browse(query, {}, proc)), expected[0]);
    } finally {
      await unhide(hidden);
      await invalidateListings();
    }
  }
});

test("a failing hit read fails the page as it does without the cache", async t => {
  t.mock.method(console, "error", () => {});
  const proc = await otherProcess("failing-hits");
  const query: CatalogQuery = { q: "filtre", sort: asc };
  const broken = (text: string) => text.startsWith("WITH main AS MATERIALIZED") ? failure("XX000") : undefined;
  await intercepted(broken, () => assert.rejects(live(() => browse(query, {})), /simulated XX000/));
  await intercepted(broken, () => assert.rejects(browse(query, {}, proc), /simulated XX000/));
  assert.equal((await sent(() => browse(query, {}, proc))).orders, 1, "nothing was held or kept: the next request loads");
});

test("the budget of ids: the least recently used key is rebuilt on return, the newest stays, the weight stays within a budget and one entry", async () => {
  const stale = await import("../src/lib/stale-cache");
  // staleCacheStats counts the caches a production process creates.
  const proc = await withEnv({ SEARCH_PRICE_ORDER_MAX_IDS: "100", NODE_ENV: "production" }, () => otherProcess("budget"));
  const [a, b, c]: CatalogQuery[] = [{ q: "fren", sort: asc }, { q: "fren", sort: desc }, { q: "filtre", sort: asc }];
  const orders = async (query: CatalogQuery) => (await sent(() => browse(query, {}, proc))).orders;
  assert.equal(await orders(a), 1);
  assert.equal(await orders(b), 1, "72 + 72 ids is over the budget: the older one goes");
  assert.equal(await orders(b), 0, "the newest stays");
  assert.ok(stale.staleCacheStats().weight <= 100 + 72, `weight ${stale.staleCacheStats().weight}`);
  assert.equal(await orders(a), 1, "the evicted key is rebuilt on return");
  assert.equal(await orders(a), 0);
  assert.equal(await orders(b), 1, "and the rebuilt one pushed the other out");
  assert.equal(await orders(c), 1);
  assert.equal(await orders(c), 0, "a small order beside the newest, within the budget");
  assert.ok(stale.staleCacheStats().weight <= 100 + 72, `weight ${stale.staleCacheStats().weight}`);
  assert.equal(await withEnv({ SEARCH_PRICE_ORDER_MAX_IDS: "0" }, async () => (await import("../src/modules/store/search-price-order")).searchPriceOrderMaxIds()), 1_000_000, "invalid: the default");
});

test("packIds and unpackIds round trip uuid[] literals", async () => {
  const { packIds, idCount, unpackIds } = await import("../src/modules/store/search-price-order");
  assert.equal(idCount(packIds("{}")), 0);
  assert.deepEqual(unpackIds(packIds("{}"), 0, 24), []);
  const one = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  assert.deepEqual(unpackIds(packIds(`{${one}}`), 0, 24), [one]);
  const many = Array.from({ length: 50 }, () => crypto.randomUUID());
  const packed = packIds(`{${many.join(",")}}`);
  assert.equal(idCount(packed), 50);
  assert.equal(packed.length, 800, "16 bytes an id");
  assert.deepEqual(unpackIds(packed, 0, 50), many);
  assert.deepEqual(unpackIds(packed, 24, 24), many.slice(24, 48));
  assert.deepEqual(unpackIds(packed, 48, 24), many.slice(48), "the partial last page");
  assert.deepEqual(unpackIds(packed, 50, 24), [], "past the end");
  assert.deepEqual(unpackIds(packed, 480, 24), []);
  assert.deepEqual(unpackIds(packed, 3, 0), []);
  assert.throws(() => packIds("{0a1b2c3d-4e5f}"), /Malformed/);
  assert.throws(() => packIds("{zzzzzzzz-4e5f-4a6b-8c7d-9e0f1a2b3c4d}"), /Malformed/);
});

test("SEARCH_PRICE_ORDER=0 sends the live statements and never touches the cache; switching it back loads", async () => {
  const proc = await otherProcess("kill-switch");
  const query: CatalogQuery = { q: "fren", sort: asc, page: "2" };
  const expected = shape(await live(() => browse(query, {})));
  await withEnv({ SEARCH_PRICE_ORDER: "0" }, async () => {
    for (let read = 0; read < 2; read++) {
      const off = await sent(async () => assert.deepEqual(shape(await browse(query, {}, proc)), expected));
      assert.deepEqual({ orders: off.orders, livePages: off.livePages, hits: off.hits, counts: off.counts }, { orders: 0, livePages: 1, hits: 1, counts: 1 }, `read ${read}`);
    }
  });
  const on = await sent(async () => assert.deepEqual(shape(await browse(query, {}, proc)), expected));
  assert.deepEqual({ orders: on.orders, livePages: on.livePages }, { orders: 1, livePages: 0 }, "the switch left nothing in the cache");
  assert.equal((await withEnv({ SEARCH_PRICE_ORDER: " 0 " }, () => sent(() => browse(query, {}, proc)))).livePages, 1, "read per request, trimmed");
});


// The ranked orders (#1440): relevance with a filter and newest, from the live ranked page's rows and ORDER BY.
const newest = "newest" as const;
const sorts: [string, CatalogQuery["sort"]][] = [["no sort", undefined], ["relevance", "relevance"], ["newest", newest]];

test("every page of the relevance and newest orders of every search kind is the live ranked page: ids, total, page, pages and notes", async () => {
  const proc = await otherProcess("rank-oracle");
  // Specs whose relevance order differs from newest (distinct ranks), so a wrong rank cannot pass on the fixture's ties.
  const distinct: Spec[] = [
    ["two words, brand (distinct ranks)", { q: "fren balatasi", brands: JSON.stringify(["TRW"]) }],
    ["code, supplied (distinct ranks)", { q: "P10", searchBy: "code", availability: "supplied" }],
  ];
  const kinds: Spec[] = [...specs, ...distinct, ["plain newest of another word", { q: "filtre" }]];
  let orders = 0, nonEmpty = 0;
  const idsOf = async (query: CatalogQuery, context: { vehicleTypeId?: string }) => (await Promise.all([1, 2, 3, 4].map(page => browse({ ...query, page: String(page) }, context, proc)))).flatMap(result => result.items.map(item => item.id));
  for (const [label, base, context = {}] of distinct) {
    const [relevance, byDate] = [await idsOf({ ...base, sort: "relevance" }, context), await idsOf({ ...base, sort: newest }, context)];
    assert.ok(relevance.length > 24, `${label}: lists something`);
    assert.notDeepEqual(relevance, byDate, `${label}: relevance and newest differ, or the fixture degraded to ties`);
  }
  for (const [label, base, context = {}] of kinds) {
    for (const [sortLabel, sort] of sorts) {
      for (const page of [undefined, "1", "2", "3", "4", "99", "0", "x"]) {
        const query = { ...base, sort, page };
        let cached: ReturnType<typeof shape> | undefined;
        orders += (await sent(async () => { cached = shape(await browse(query, context, proc)); })).orders;
        const expected = shape(await live(() => browse(query, context)));
        assert.deepEqual(cached, expected, `${label} ${sortLabel} page ${page}`);
        if (page === "1" && expected.total > 0) nonEmpty++;
      }
    }
  }
  assert.ok(orders >= 20 && nonEmpty >= 30, `${orders} orders, ${nonEmpty} non-empty`);
  // The notes the search reads carry over, on a ranked order too.
  assert.equal(shape(await browse({ q: "frenx", sort: newest }, {}, proc)).correctedQuery, "fren");
  assert.equal(shape(await browse({ q: "f", sort: newest }, {}, proc)).searchTooShort, true);
  assert.deepEqual(shape(await browse({ q: "bosch golf", sort: newest }, {}, proc)).vehicleScope, { productText: "bosch", vehicleText: "golf", fitted: false });
  // The fixtures tie: the order is saleable first, newest first within a rank, ties by id; the renamed row is ranked from its name.
  const all = (await Promise.all([1, 2, 3].map(page => browse({ q: "fren", sort: newest, page: String(page) }, {}, proc)))).flatMap(result => result.items);
  assert.equal(all.length, 72);
  const stamps = all.filter(card => !card.unavailable).map(card => `${new Date(card.updated_at as unknown as string).getTime()}`);
  assert.ok(new Set(stamps).size < stamps.length, "updated_at ties exist");
  for (let index = 1; index < all.length; index++) {
    const [previous, card] = [all[index - 1], all[index]];
    if (previous.unavailable !== card.unavailable) { assert.ok(!previous.unavailable, "saleable first"); continue; }
    const [before, now] = [new Date(previous.updated_at as unknown as string).getTime(), new Date(card.updated_at as unknown as string).getTime()];
    assert.ok(before > now || (before === now && previous.id < card.id), `newest: ${index}`);
  }
  const relevance = (await Promise.all([1, 2, 3].map(page => browse({ q: "fren", availability: "supplied", sort: "relevance", page: String(page) }, {}, proc)))).flatMap(result => result.items);
  assert.ok(relevance.some(card => card.id === ids[0]) && new Set(relevance.map(card => card.id)).size === relevance.length, "the renamed row is listed once");
});

test("a warm ranked page sends only its card reads; no sort and relevance share a key, newest has its own", async () => {
  const proc = await otherProcess("rank-warm");
  const query: CatalogQuery = { q: "fren", brands: JSON.stringify(["TRW"]) };
  const cold = await sent(() => browse({ ...query, page: "1" }, {}, proc));
  assert.deepEqual({ orders: cold.orders, hits: cold.hits, rankPages: cold.rankPages, counts: cold.counts }, { orders: 1, hits: 1, rankPages: 0, counts: 0 }, "the cold page: the hits and one order");
  for (const sort of [undefined, "relevance", undefined] as const) for (const page of ["2", "1", "3"]) {
    const warm = await sent(() => browse({ ...query, sort, page }, {}, proc));
    assert.deepEqual({ orders: warm.orders, hits: warm.hits, rankPages: warm.rankPages, counts: warm.counts, offsets: warm.offsets }, { orders: 0, hits: 0, rankPages: 0, counts: 0, offsets: 0 }, `${sort} page ${page}`);
    assert.ok(warm.texts.length > 0 && warm.texts.every(isCardRead), `${sort} page ${page}: ${warm.texts.filter(text => !isCardRead(text)).join(" | ")}`);
  }
  assert.equal((await sent(() => browse({ ...query, sort: newest, page: "2" }, {}, proc))).orders, 1, "newest is another key");
  const warmNewest = await sent(() => browse({ ...query, sort: newest, page: "1" }, {}, proc));
  assert.deepEqual({ orders: warmNewest.orders, hits: warmNewest.hits, rankPages: warmNewest.rankPages, counts: warmNewest.counts }, { orders: 0, hits: 0, rankPages: 0, counts: 0 });
  assert.equal((await sent(() => browse({ ...query, page: "2" }, {}, proc))).orders, 0, "and relevance is still kept");
  assert.equal((await sent(() => browse({ q: "fren", sort: newest }, {}, proc))).orders, 1, "plain newest is a key too");
  assert.equal((await sent(() => browse({ q: "fren", sort: newest, page: "2" }, {}, proc))).orders, 0);
});

test("an epoch bump reloads every ranked key; the fit sync's bump only the ones that read vehicle fits", () => patient(async () => {
  const proc = await otherProcess("rank-epochs");
  const keys: [string, CatalogQuery, boolean][] = [
    ["brand", { q: "fren", brands: JSON.stringify(["TRW"]) }, false],
    ["plain newest", { q: "fren", sort: newest }, false],
    ["code search", { q: "P10", searchBy: "code", sort: newest }, false],
    ["category", { q: "fren", category: "fren" }, false],
    ["two words", { q: "bosch golf", sort: newest }, true],
    ["make filter", { q: "fren", make: "vw" }, true],
    ["the garage vehicle's filter", { q: "fren", fits: "vehicle" }, true],
  ];
  const context = (query: CatalogQuery) => query.fits ? vw : {};
  const read = async (query: CatalogQuery) => (await sent(() => browse(query, context(query), proc))).orders;
  for (const [label, query] of keys) assert.equal(await read(query), 1, `${label}: loaded`);
  for (const [label, query] of keys) assert.equal(await read(query), 0, `${label}: kept`);
  await invalidateFits();
  for (const [label, query, fits] of keys) assert.equal(await read(query), fits ? 1 : 0, `${label}: after the fit sync's bump`);
  await invalidateListings();
  for (const [label, query] of keys) assert.equal(await read(query), 1, `${label}: after an admin edit's bump`);
  for (const [label, query] of keys) assert.equal(await read(query), 0, `${label}: kept again`);
}));

test("a failed ranked order statement reads that request live and holds the key; a held key bypasses the cache", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const minute = 60 * 1000;
  for (const [code, holdMs] of [["57014", 60 * minute], ["53200", 10 * minute]] as const) {
    const proc = await otherProcess(`rank-failing${code}`);
    const query: CatalogQuery = { q: "fren", availability: "in_stock", sort: newest }, next: CatalogQuery = { ...query, page: "2" };
    const expected = [shape(await live(() => browse(query, {}))).ids, shape(await live(() => browse(next, {}))).ids];
    let attempts = 0, failing = true;
    await intercepted(text => {
      if (!isOrder(text)) return undefined;
      attempts++;
      return failing ? failure(code) : undefined;
    }, async () => {
      const first = await sent(async () => assert.deepEqual(shape(await browse(query, {}, proc)).ids, expected[0], `${code}: the live page`));
      assert.ok(first.rankPages >= 1 && attempts === 1, `${code}: read live after one order statement`);
      const second = await sent(async () => assert.deepEqual(shape(await browse(next, {}, proc)).ids, expected[1], `${code}: the next page is live too`));
      assert.ok(second.rankPages >= 1 && second.orders === 0, `${code}: held: live page, no order statement`);
      t.mock.timers.tick(holdMs - 1);
      await browse(query, {}, proc);
      assert.equal(attempts, 1, `${code}: no order statement within the hold`);
      failing = false;
      t.mock.timers.tick(1);
      assert.deepEqual(shape(await browse(next, {}, proc)).ids, expected[1]);
      assert.equal(attempts, 2, `${code}: one again after the hold`);
    });
    assert.equal((await sent(() => browse(query, {}, proc))).orders, 0, `${code}: the order is kept now`);
  }
});

test("SEARCH_RANK_ORDER=0 reads the ranked searches live and leaves price orders cached; SEARCH_PRICE_ORDER=0 the reverse", async () => {
  const proc = await otherProcess("rank-switches");
  const ranked: CatalogQuery = { q: "fren", availability: "in_stock", page: "2" }, priced: CatalogQuery = { q: "fren", sort: asc, page: "2" };
  const [rankedExpected, pricedExpected] = [shape(await live(() => browse(ranked, {}))), shape(await live(() => browse(priced, {})))];
  await withEnv({ SEARCH_RANK_ORDER: "0" }, async () => {
    for (let read = 0; read < 2; read++) {
      const off = await sent(async () => assert.deepEqual(shape(await browse(ranked, {}, proc)), rankedExpected));
      assert.deepEqual({ orders: off.orders, rankPages: off.rankPages, hits: off.hits, counts: off.counts }, { orders: 0, rankPages: 1, hits: 1, counts: 1 }, `read ${read}`);
    }
    assert.equal((await sent(async () => assert.deepEqual(shape(await browse(priced, {}, proc)), pricedExpected))).orders, 1, "the price order is cached");
    assert.equal((await sent(() => browse(priced, {}, proc))).orders, 0);
  });
  const on = await sent(async () => assert.deepEqual(shape(await browse(ranked, {}, proc)), rankedExpected));
  assert.deepEqual({ orders: on.orders, rankPages: on.rankPages }, { orders: 1, rankPages: 0 }, "the switch left nothing in the cache");
  assert.equal((await withEnv({ SEARCH_RANK_ORDER: " 0 " }, () => sent(() => browse(ranked, {}, proc)))).rankPages, 1, "read per request, trimmed");
  await withEnv({ SEARCH_PRICE_ORDER: "0" }, async () => {
    assert.equal((await sent(() => browse(ranked, {}, proc))).orders, 0, "the rank order is still kept");
    const off = await sent(async () => assert.deepEqual(shape(await browse(priced, {}, proc)), pricedExpected));
    assert.deepEqual({ orders: off.orders, livePages: off.livePages }, { orders: 0, livePages: 1 }, "the price sort is live");
  });
});

test("a ranked order and a price order share SEARCH_PRICE_ORDER_MAX_IDS", async () => {
  const proc = await withEnv({ SEARCH_PRICE_ORDER_MAX_IDS: "100", NODE_ENV: "production" }, () => otherProcess("rank-budget"));
  const [rank, price]: CatalogQuery[] = [{ q: "fren", sort: newest }, { q: "fren", sort: asc }];
  const orders = async (query: CatalogQuery) => (await sent(() => browse(query, {}, proc))).orders;
  assert.equal(await orders(rank), 1);
  assert.equal(await orders(rank), 0);
  assert.equal(await orders(price), 1, "72 + 72 ids is over the budget: the rank order goes");
  assert.equal(await orders(price), 0, "the price order stays");
  assert.equal(await orders(rank), 1, "the evicted rank order is rebuilt on return");
});

const fitCount = (query: CatalogQuery, from: Catalog = catalog) => inRequest(() => from.vehicleFitCount(query, vw.vehicleTypeId));
const lead = async (query: CatalogQuery, from: Catalog = catalog) => (await inRequest(() => from.vehicleLead(query, vw.vehicleTypeId))).total;

test("vehicleFitCount of a search reads the total of the order vehicleLead's page 1 reads, also after a change without a bump (#1450)", async () => {
  for (const query of [{ q: "fren" }, { q: "fren", sort: newest }, { q: "fren", sort: asc, availability: "in_stock" }] as CatalogQuery[]) {
    const proc = await otherProcess(`fit-count-${query.sort ?? "relevance"}`);
    const total = await lead(query, proc);
    assert.ok(total > 0);
    assert.equal(await fitCount({ ...query, page: "3" }, proc), total, "page 2+ shows page 1's figure");
    const { rows: [fitting] } = await schema.pool.query<{ id: string }>(
      "SELECT id::text FROM supplier_items WHERE presence='present' AND code ~ '[0-5]$' AND product_data->>'ac' ILIKE 'TRW FREN%' ORDER BY code LIMIT 1");
    await hide(fitting.id);
    try {
      assert.equal(await fitCount(query, proc), total, "the cached total until the reload");
      assert.equal(await lead(query, proc), total);
      const liveCount = await live(() => fitCount(query));
      assert.equal(liveCount, total - 1, "the change did move the live count");
      assert.equal(await fitCount(query, await otherProcess(`fit-count-fresh-${query.sort ?? "relevance"}`)), liveCount, "a fresh process loads the new state");
    } finally {
      await unhide(fitting.id);
    }
  }
});

test("a warm vehicleFitCount of a search sends no hit read and no count (#1450)", async () => {
  const proc = await otherProcess("fit-count-warm");
  const query: CatalogQuery = { q: "fren", availability: "in_stock" };
  await lead(query, proc);
  const warm = await sent(() => fitCount({ ...query, page: "2" }, proc));
  assert.deepEqual({ hits: warm.hits, counts: warm.counts, orders: warm.orders }, { hits: 0, counts: 0, orders: 0 });
});

test("vehicleFitCount is the live count with the kill switch of its sort at 0, and for a held key (#1450)", async t => {
  const proc = await otherProcess("fit-count-live");
  const ranked: CatalogQuery = { q: "fren", sort: newest }, priced: CatalogQuery = { q: "fren", sort: asc };
  const expected = [await live(() => fitCount(ranked)), await live(() => fitCount(priced))];
  for (const [query, name, want] of [[ranked, "SEARCH_RANK_ORDER", expected[0]], [priced, "SEARCH_PRICE_ORDER", expected[1]]] as const) {
    const off = await withEnv({ [name]: "0" }, () => sent(async () => assert.equal(await fitCount(query, proc), want)));
    assert.deepEqual({ orders: off.orders, hits: off.hits >= 1, counts: off.counts >= 1 }, { orders: 0, hits: true, counts: true }, name);
  }
  t.mock.method(console, "error", () => {});
  const held = await otherProcess("fit-count-held"), query: CatalogQuery = { q: "fren", availability: "in_stock" };
  const want = await live(() => fitCount(query));
  await intercepted(text => (isOrder(text) || text.includes("catalog.searchOrder") ? failure("53200") : undefined), async () => {
    assert.equal(await fitCount(query, held), want, "the failed build reads live");
    const again = await sent(async () => assert.equal(await fitCount(query, held), want));
    assert.ok(again.orders === 0 && again.hits >= 1 && again.counts >= 1, "held: live hit read and count, no order statement");
  });
});
