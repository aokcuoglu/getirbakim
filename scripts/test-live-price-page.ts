import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { after, before, test } from "node:test";
import pg from "pg";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

// The live deep price page (#1430) in an isolated copy of the schema: it orders and pages on the lean columns (id,
// unavailable, price_kurus) and reads the page's cards by id afterwards. Its ids, order and card rows must be those of the
// page it replaced, `SELECT *` over the storefront view with the same ORDER BY, LIMIT and OFFSET (the oracle below
// rewrites the statement the app sent into that one, with its own frozen ORDER BY). Nothing is written to the shared
// database's tables.
type Catalog = typeof import("../src/modules/store/catalog");
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: Catalog;
let closeDb: () => Promise<void>;
const [basbug] = storefrontCompanies();

// The category tree (getStoreCategories) calls connection(), which needs a request scope: a static work store lets it
// run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the other imports).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);
const browse = (query: CatalogQuery) => inRequest(() => catalog.browseProducts(query));

/** `run` with these environment variables set, restored afterwards. */
async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
/** Every stored order and cache off: each page this suite reads is a live one (pages past the cached first 20). */
const live = <T>(run: () => Promise<T>) => withEnv({ LISTING_PRICE_ORDER: "0", LISTING_PRICE_ORDER_FILTERED: "0", SEARCH_PRICE_ORDER: "0" }, run);

type Sent = { text: string; values: unknown[] };
/**
 * Runs `run` with every statement passed to `onResult` once it has a result (`rows`): a statement sent callback-style
 * (Pool.query) or promise-style (boundedQuery's client). `onResult` may hold the result back by returning a promise.
 */
async function observed(onResult: (sent: Sent, rows: { id?: string }[]) => Promise<void> | void, run: () => Promise<unknown>) {
  const original = pg.Client.prototype.query as (...args: unknown[]) => unknown;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "";
    const values = (typeof config === "string" ? args[1] : (config as { values?: unknown[] }).values) as unknown[] | undefined;
    const sent = { text, values: Array.isArray(values) ? values : [] };
    const callback = args.find(arg => typeof arg === "function") as ((error: Error | null, result?: pg.QueryResult) => void) | undefined;
    if (callback) {
      const wrapped = (error: Error | null, result?: pg.QueryResult) => {
        if (error || !result) return callback(error, result);
        Promise.resolve(onResult(sent, result.rows)).then(() => callback(null, result), failure => callback(failure as Error));
      };
      return original.apply(this, args.map(arg => (arg === callback ? wrapped : arg)));
    }
    const result = original.apply(this, args);
    return result instanceof Promise ? result.then(async (done: pg.QueryResult) => { await onResult(sent, done.rows); return done; }) : result;
  } as typeof pg.Client.prototype.query;
  try {
    await run();
  } finally {
    pg.Client.prototype.query = original as typeof pg.Client.prototype.query;
  }
}
/** The live price page statements: the ordered, paged read (a stored order's build and the cached heads have no OFFSET). */
const isLivePage = (text: string) => /^SELECT (catalog\.id::text|\*) FROM \([\s\S]*ORDER BY [\s\S]+ LIMIT \d+ OFFSET \$\d+/.test(text);
async function livePageStatements(run: () => Promise<unknown>) {
  const found: Sent[] = [];
  await observed(sent => { if (isLivePage(sent.text)) found.push(sent); }, run);
  return found;
}

const rows = 2400;
const asc = "price-asc" as const, desc = "price-desc" as const;
before(async () => {
  schema = await isolatedSchema("live_price_page_test");
  const brandNames = ["BOSCH", "TRW"];
  for (const name of brandNames) {
    const { rows: [brand] } = await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES($1,$1) RETURNING id::text", [name]);
    await schema.pool.query("INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES('basbug',$1,$2,$3)", [name, brand.id, rows / 2]);
  }
  // 2400 rows: BOSCH odd, TRW even; costs 40-139, each shared by about 24 rows (ties by id); every 17th dropped by its
  // supplier (unavailable, no price); every 4th out of stock; two in three in the "fren" category (a name of its own).
  await schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    SELECT 'basbug',$1,'G','MRK','P'||n,jsonb_build_object('uk',CASE WHEN n%2=1 THEN 'BOSCH' ELSE 'TRW' END,'ac','FREN BALATASI P'||n,'ac2','','dc','TL')
      || CASE WHEN n%3<>0 THEN '{"category":"fren"}'::jsonb ELSE '{}'::jsonb END,
    jsonb_build_object('nf',40+(n*37)%100),jsonb_build_object('stok',CASE WHEN n%4=0 THEN 0 ELSE 2 END),1,1,1,
    CASE WHEN n%17=0 THEN 'inactive' ELSE 'present' END,now()-interval '30 days',now(),now() FROM generate_series(1,$2::int) n`, [basbug, rows]);
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT 1,id FROM supplier_items WHERE code ~ '[02468]$'`);
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
    ('trodo',3,NULL,'Yedek parçalar','yedek-parca','{3}','','{}'),('trodo',252,3,'Fren','fren','{3,252}','','{}');
    INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
    ('trodo',3,'tr','Yedek parçalar','yedek-parca'),('trodo',252,'tr','Fren','fren')`);
  await schema.pool.query("INSERT INTO search_vocabulary(scope,word,frequency) VALUES('product','fren',100),('product','balatasi',100)");
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, catalogModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog")]);
  catalog = catalogModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

/**
 * What the page replaced shows for the statement the app sent: the same rows (its own WHERE and values), ordered by this
 * suite's frozen ORDER BY, paged by the same LIMIT and OFFSET, as `SELECT *` over the view, then its offers.
 */
async function previousPage(sent: Sent, sort: typeof asc | typeof desc) {
  const frozen = `unavailable,price_kurus ${sort === asc ? "ASC" : "DESC"} NULLS LAST,id`;
  const text = sent.text.replace(/^SELECT catalog\.id::text FROM/, "SELECT * FROM").replace(/ORDER BY .+? LIMIT/, `ORDER BY ${frozen} LIMIT`);
  assert.ok(text.startsWith("SELECT * FROM (") && text.includes(`ORDER BY ${frozen} LIMIT`), "the oracle rewrote the statement");
  return catalog.withBestOffers((await schema.pool.query<Awaited<ReturnType<Catalog["browseProducts"]>>["items"][number]>(text, sent.values)).rows);
}

type Spec = [string, CatalogQuery, number[]];
const specs: Spec[] = [
  ["plain", {}, [21, 22, 50, 100, 101]],
  ["brand", { brand: "BOSCH" }, [21, 25, 26, 99]],
  ["brands", { brands: JSON.stringify(["TRW"]) }, [21, 25, 99]],
  ["category", { category: "fren" }, [21, 33, 99]],
  ["category and brand (two id sets)", { category: "fren", brands: JSON.stringify(["BOSCH"]) }, [21, 27, 99]],
  ["category and make (two id sets)", { category: "fren", make: "vw" }, [21, 27, 99]],
  ["in stock", { availability: "in_stock" }, [21, 80, 99]],
  ["out of stock", { availability: "out_of_stock" }, [21, 25, 99]],
  ["supplied", { availability: "supplied" }, [21, 90, 99]],
  ["search with the kill switch", { q: "fren" }, [1, 21, 100, 99]],
  ["search and category with the kill switch", { q: "fren", category: "fren" }, [1, 21, 99]],
];

for (const [name, base, pages] of specs) {
  test(`${name}: the live page's ids, order and card rows are the previous page's, both sorts`, async () => {
    let compared = 0;
    for (const sort of [asc, desc]) for (const page of pages) {
      const query: CatalogQuery = { ...base, sort, page: String(page) };
      let shown: Awaited<ReturnType<typeof browse>> | undefined;
      const statements = await livePageStatements(async () => { shown = await live(() => browse(query)); });
      assert.ok(shown, `${sort} page ${page}`);
      // Pages the cached first pages serve send no live page: only the deep ones are compared.
      if (!statements.length) {
        assert.ok(shown.page <= 20, `${sort} page ${page} (${shown.page}) read live`);
        continue;
      }
      assert.equal(statements.length, 1, `${sort} page ${page}: one live page statement`);
      const previous = await previousPage(statements[0], sort);
      assert.deepEqual(shown.items.map(card => card.id), previous.map(card => card.id), `${sort} page ${page}: ids and order`);
      assert.deepEqual(JSON.parse(JSON.stringify(shown.items)), JSON.parse(JSON.stringify(previous)), `${sort} page ${page}: card rows`);
      assert.ok(shown.items.length > 0 && shown.items.length <= 24);
      compared++;
    }
    assert.ok(compared >= 2, `${name}: live deep pages compared (${compared})`);
  });
}

test("a page's cards stay in the order of the lean ids; unavailable cards (no price) come last, equal prices by id", async () => {
  const last = (await live(() => browse({ sort: asc, page: "100" }))).items;
  const all: typeof last = [];
  for (let page = 21; page <= 100; page++) all.push(...(await live(() => browse({ sort: asc, page: String(page) }))).items);
  assert.ok(all.length > 24 * 70);
  assert.ok(last.length > 0 && last.every(card => card.unavailable && card.price_kurus === null), "the last page: unavailable, no price");
  let ties = 0;
  for (let index = 1; index < all.length; index++) {
    const [previous, card] = [all[index - 1], all[index]];
    if (previous.unavailable || previous.price_kurus === null) {
      assert.ok(card.unavailable && card.price_kurus === null, `${index}: nothing priced after an unavailable card`);
      continue;
    }
    if (card.unavailable) continue;
    assert.ok(card.price_kurus! > previous.price_kurus! || (card.price_kurus === previous.price_kurus && card.id > previous.id), `${index}: order`);
    if (card.price_kurus === previous.price_kurus) ties++;
  }
  assert.ok(ties > 1000, "most prices are shared");
});

test("the ordering statement sends the lean columns: no SELECT * and no pricing snapshot, whatever the filter", async () => {
  for (const base of [{}, { brand: "BOSCH" }, { availability: "in_stock" as const }, { category: "fren", make: "vw" }, { q: "fren" }]) for (const sort of [asc, desc]) {
    const statements = await livePageStatements(() => live(() => browse({ ...base, sort, page: "21" })));
    assert.equal(statements.length, 1, JSON.stringify(base));
    const [{ text }] = statements;
    assert.ok(text.startsWith("SELECT catalog.id::text FROM ("), `${JSON.stringify(base)}: ids only`);
    // The unavailable split and the id tie-break stay in the ordering statement itself: unavailable cards carry no price
    // today, so NULLS LAST alone would give the same rows, and only the statement shows the split was dropped.
    assert.ok(text.includes(`ORDER BY unavailable,price_kurus ${sort === asc ? "ASC" : "DESC"} NULLS LAST,id LIMIT 24 OFFSET`), `${JSON.stringify(base)}: the ordering`);
    assert.ok(!/^SELECT \*/.test(text) && !text.includes("pricing_snapshot"), `${JSON.stringify(base)}: no row projection`);
  }
});

test("a card that disappears between the id read and the card read is left out of the page, the rest keep their order", async () => {
  const query: CatalogQuery = { sort: asc, page: "30" };
  const expected = (await live(() => browse(query))).items.map(card => card.id);
  assert.equal(expected.length, 24);
  const [gone] = [expected[5]];
  let done = false;
  let shown: string[] = [];
  try {
    await observed(async (sent, found) => {
      if (isLivePage(sent.text) && !done) {
        done = true;
        assert.equal(found[5].id, gone);
        await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [gone]);
      }
    }, async () => { shown = (await live(() => browse(query))).items.map(card => card.id); });
    assert.ok(done);
    assert.deepEqual(shown, expected.filter(id => id !== gone), "23 cards, the same order, no error");
  } finally {
    await schema.pool.query("DELETE FROM commerce_item_overrides WHERE supplier_item_id=$1", [gone]);
  }
});
