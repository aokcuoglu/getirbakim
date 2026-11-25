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
// Nothing is written to the shared database's tables.
type Catalog = typeof import("../src/modules/store/catalog");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: Catalog;
let priceOrder: typeof import("../src/modules/store/listing-price-order");
let invalidateListings: () => Promise<void>;
let closeDb: () => Promise<void>;
const [basbug] = storefrontCompanies();

// The category tree (getStoreCategories) calls connection(), which needs a request scope: a static work store lets it
// run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the other imports).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);

/** Another app process: a second copy of the catalog module, with its own process caches, on the same database and epoch. */
const otherProcess = async (name: string) => await import(`../src/modules/store/catalog.ts?${name}`) as Catalog;
/** Polls `read` until `done` holds or the deadline passes (loads finish in the background). */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
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
 * statement without sending it (only for promise-style calls, as boundedQuery's).
 */
async function intercepted(onText: (text: string) => Error | undefined, run: () => Promise<unknown>) {
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    const failure = onText(typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "");
    return failure ? Promise.reject(failure) : (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as typeof original;
  try {
    await run();
  } finally {
    pg.Client.prototype.query = original;
  }
}
/** What `run` sends on any connection: stored-order builds, live price pages (ORDER BY … OFFSET) and statements naming the table. */
async function sent(run: () => Promise<unknown>) {
  const texts: string[] = [];
  await intercepted(text => { texts.push(text); return undefined; }, run);
  return {
    builds: texts.filter(text => text.includes("INSERT INTO storefront_listing_price_orders")).length,
    livePages: texts.filter(text => /ORDER BY unavailable,price_kurus (ASC|DESC) NULLS LAST,id LIMIT \d+ OFFSET/.test(text)).length,
    table: texts.filter(text => text.includes("storefront_listing_price_orders")).length,
  };
}

type Sort = "price-asc" | "price-desc";
const bosch = (sort: Sort, page: number): CatalogQuery => ({ manufacturer: "bosch", sort, page: String(page) });
const cards = (query: CatalogQuery, from: Catalog = catalog) => inRequest(async () => (await from.browseProducts(query)).items);
const pageIds = async (query: CatalogQuery, from: Catalog = catalog) => (await cards(query, from)).map(card => card.id);
/** The page read live, as before #1369. */
const livePage = (query: CatalogQuery) => withEnv({ LISTING_PRICE_ORDER: "0" }, () => pageIds(query));
const stored = async () => (await schema.pool.query<{ epoch: number; total: number; age_s: number }>(
  "SELECT epoch::int,total,extract(epoch FROM now()-computed_at)::int AS age_s FROM storefront_listing_price_orders ORDER BY epoch DESC,total DESC")).rows;
const currentEpoch = async () => (await schema.pool.query<{ epoch: number }>("SELECT epoch::int FROM storefront_listing_epoch")).rows[0].epoch;
const hide = (id: string) => schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [id]);
/** BOSCH rows and pages: 560 rows (5 dropped by their supplier, listed last), 24 pages of 24 cards, the last one of 8. */
const rows = 560, pages = 24;

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

test("pages 21-23 send one build and no live page; pages 1-20 neither", async () => {
  await schema.pool.query("TRUNCATE storefront_listing_price_orders");
  await invalidateListings();
  assert.deepEqual(await sent(async () => { for (let page = 1; page <= 20; page++) await pageIds(bosch("price-asc", page)); }),
    { builds: 0, livePages: 0, table: 0 });
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
  assert.deepEqual(await sent(async () => { shown = await pageIds(query, first); }), { builds: 0, livePages: 0, table: 2 }, "the size, then the slice");
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
  assert.deepEqual(await build("test|epochs", 1000, "BOSCH"), { total: listed });
  const boschFirst = await priceOrder.priceOrderSlice("test|epochs", 0, 3);
  assert.equal(boschFirst?.length, 3);
  assert.deepEqual(await build("test|epochs", 999, "MAHLE"), { total: 0 }, "an older epoch: nothing stored");
  assert.deepEqual(await priceOrder.priceOrderSlice("test|epochs", 0, 3), boschFirst);
  assert.deepEqual(await build("test|epochs", 1000, "MAHLE"), { total: 5 }, "the same epoch replaces it");
  const meta = await priceOrder.priceOrderStore.read("test|epochs");
  assert.deepEqual([meta?.value, meta?.epoch], [{ total: 5 }, 1000]);
  assert.deepEqual(await priceOrder.priceOrderSlice("test|epochs", 3, 24), (await priceOrder.priceOrderSlice("test|epochs", 0, 5))!.slice(3), "a slice ends with the order");
  assert.deepEqual(await priceOrder.priceOrderSlice("test|epochs", 5, 24), [], "past the end: empty");
  assert.equal(await priceOrder.priceOrderSlice("test|missing", 0, 24), null, "no row");
  await withEnv({ LISTING_PRICE_ORDER_MAX_IDS: "100" }, async () => {
    assert.deepEqual(await build("test|cap", 1000, "BOSCH"), { total: 0 });
    assert.deepEqual(await build("test|cap", 1000, "MAHLE"), { total: 5 });
  });
  assert.deepEqual(await build("test|empty", 1000, "NOBODY"), { total: 0 });
  assert.equal(await priceOrder.priceOrderStore.read("test|empty"), null);
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
  })), { builds: 0, livePages: 4, table: 0 });
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

// Next to last: it moves the clock (Date only) ten minutes and more ahead. This process's polled listing epoch then stays
// as it last read it until the real clock catches up; the tests after it move it through invalidateListings() only.
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
