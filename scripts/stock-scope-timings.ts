import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { loadavg } from "node:os";
import type { PoolClient } from "pg";

// npm run catalog:stock-scope-timings -- [--passes=N] [--page=N] <scope>... (#1429, #1455). Read-only: every timed
// statement runs in a READ ONLY transaction that is rolled back, and nothing is written through the listing caches (no
// storefront_listing_cache or storefront_listing_price_orders write); building the scoped side reads its stock scope once
// (a plain SELECT, kept in this process's scope cache).
// Compares a stock-filtered listing's reads (stockListingStatements in src/modules/store/catalog.ts) built with
// LISTING_STOCK_SCOPE_MAX_IDS=0, the whole stock set's clause, and with the setting in force (default 30,000: scoped when
// the listing's smallest bound id array holds at most that many ids, src/modules/store/stock-filter.ts):
// - equality: both sides on one REPEATABLE READ snapshot give the same count, the same page ids in the default order
//   (newest) and the same price-asc page, read as pricedScope does (over two or more id sets its listed ids first);
// - wall time of each read per side, each statement in its own transaction, the side that runs first alternating per
//   pass; the price page's time includes its listed-id read. Out of stock over the whole set runs at its 32 MB work_mem.
//   "scope read": a brand, manufacturer or make-only listing's stock scope read (its listed ids, read at most once per 10
//   minutes and cached, so not part of the scoped reads' times), none on the whole side or for a listing that binds its own
//   array.
// `--page` (default 1) is the page of ids in both orders; past the listing's last page it reads the last one, as
// browseProducts clamps it (the table's page column says which).
// A scope is `key=value` pairs joined by `&`, with availability=in_stock or out_of_stock and any of category, make, model
// (with its make), manufacturer, brand, brands (a JSON array), attributes (a JSON object) and vehicle (a vehicle type id:
// the garage vehicle's fits): `category=fren&availability=in_stock`, `make=volkswagen&model=golf&availability=out_of_stock`,
// `brand=BOSCH&availability=in_stock`, `vehicle=12345&availability=in_stock`. A brand, manufacturer or make-only listing
// over the limit (a Volkswagen-size make) reads the same statements on both sides.
process.env.LISTING_CACHE_PERSIST = "0";
const args = process.argv.slice(2);
const flags = new Map(args.filter(arg => arg.startsWith("--")).map(arg => {
  const [name, value = "true"] = arg.slice(2).split("=");
  return [name, value];
}));
const unknownFlags = [...flags.keys()].filter(name => !["passes", "page"].includes(name));
if (unknownFlags.length) throw new Error(`Unknown flags: ${unknownFlags.join(" ")} (expected --passes=N, --page=N)`);
const passes = Number(flags.get("passes") ?? 3);
if (!Number.isSafeInteger(passes) || passes < 1) throw new Error("--passes must be a positive integer");
const page = Number(flags.get("page") ?? 1);
if (!Number.isSafeInteger(page) || page < 1) throw new Error("--page must be a positive integer");
const scopes = args.filter(arg => !arg.startsWith("--"));
if (!scopes.length) throw new Error("Name at least one scope: category=fren&availability=in_stock …");
const scopeKeys = new Set(["category", "make", "model", "manufacturer", "brand", "brands", "attributes", "availability", "vehicle"]);
function parseScope(scope: string) {
  const { vehicle, availability, ...query } = Object.fromEntries(new URLSearchParams(scope));
  const unknown = Object.keys(query).filter(key => !scopeKeys.has(key));
  if (unknown.length) throw new Error(`Invalid scope ${scope}: unknown ${unknown.join(", ")}`);
  if (availability !== "in_stock" && availability !== "out_of_stock") throw new Error(`Invalid scope ${scope}: availability=in_stock or out_of_stock`);
  if (vehicle !== undefined && !/^\d+$/.test(vehicle)) throw new Error(`Invalid vehicle in ${scope}: a vehicle type id`);
  const stock: "in_stock" | "out_of_stock" = availability;
  return { query: { ...query, availability: stock, ...(vehicle ? { fits: "vehicle" as const } : {}) }, context: vehicle ? { vehicleTypeId: vehicle } : {} };
}

// The category tree calls connection(), which needs a request scope: a static work store lets it run. Next reads the
// global AsyncLocalStorage when its storage module loads, so it is set before the imports below.
Object.assign(globalThis, { AsyncLocalStorage });
const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
const inRequest = <T>(run: () => Promise<T>) => workAsyncStorage.run({ route: "/stock-scope-timings", forceStatic: true } as Parameters<typeof workAsyncStorage.run>[0], run);
const { db } = await import("../src/lib/db");
const { stockListingStatements } = await import("../src/modules/store/catalog");

type Built = Awaited<ReturnType<typeof stockListingStatements>>;
type Side = "whole" | "scoped";
type Values = { count: number; pageIds: string[]; priceIds: string[] };

/** The statements built under LISTING_STOCK_SCOPE_MAX_IDS=`max` (undefined: the setting in force), restored afterwards. */
async function built(max: string | undefined, run: () => Promise<Built>) {
  const saved = process.env.LISTING_STOCK_SCOPE_MAX_IDS;
  if (max !== undefined) process.env.LISTING_STOCK_SCOPE_MAX_IDS = max;
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.LISTING_STOCK_SCOPE_MAX_IDS;
    else process.env.LISTING_STOCK_SCOPE_MAX_IDS = saved;
  }
}
/** Runs `read` on its own client inside a READ ONLY transaction (with `mem` as work_mem when set), always rolled back. */
async function readOnly<T>(read: (client: PoolClient) => Promise<T>, isolation = "READ COMMITTED", mem?: string): Promise<T> {
  const client = await db.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation} READ ONLY`);
    await client.query("SET LOCAL statement_timeout = 300000");
    if (mem) await client.query(`SET LOCAL work_mem = '${mem}'`);
    return await read(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
const count = async (statements: Built, client: PoolClient) => Number((await client.query<{ count: string }>(statements.count.text, statements.count.values)).rows[0].count);
const pageIds = async (statements: Built, client: PoolClient) => (await client.query<{ id: string }>(statements.pageIds.text, statements.pageIds.values)).rows.map(row => row.id);
/**
 * The price-asc page as pricedScope reads it: over two or more id sets the listed ids first, then the page by them; an
 * empty listing reads no page, as browseProducts.
 */
async function priceIds(statements: Built, client: PoolClient) {
  const row = statements.listed ? (await client.query<{ count: string; ids: string | null }>(statements.listed.text, statements.listed.values)).rows[0] : null;
  const statement = statements.pricePage(row && { count: Number(row.count), ids: row.ids });
  return statement ? (await client.query<{ id: string }>(statement.text, statement.values)).rows.map(page => page.id) : [];
}
/** Both sides on one snapshot, each at its own work_mem: the same count and ids. Returns the listing's count. */
async function sameOnOneSnapshot(scope: string, sides: Record<Side, Built>) {
  return readOnly(async client => {
    const values = {} as Record<Side, Values>;
    for (const side of ["whole", "scoped"] as const) {
      const statements = sides[side];
      await client.query(statements.workMem ? `SET LOCAL work_mem = '${statements.workMem}'` : "SET LOCAL work_mem TO DEFAULT");
      values[side] = { count: await count(statements, client), pageIds: await pageIds(statements, client), priceIds: await priceIds(statements, client) };
    }
    assert.deepEqual(values.scoped, values.whole, `${scope}: the scoped reads differ from the whole stock set's`);
    return values.whole.count;
  }, "REPEATABLE READ");
}
async function timed(run: () => Promise<unknown>) {
  const started = performance.now();
  await run();
  return Math.round(performance.now() - started);
}
const load = () => loadavg().map(value => value.toFixed(1)).join(" ");
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

type Timing = { scopeMs: number; countMs: number; pageIdsMs: number; priceMs: number };
async function timings(statements: Built): Promise<Timing> {
  const own = <T>(read: (client: PoolClient) => Promise<T>) => readOnly(read, "READ COMMITTED", statements.workMem);
  let scopeMs = 0;
  // Each scope read in its own transaction at the session's work_mem, as the scope cache's load runs it.
  for (const scope of statements.scopes) scopeMs += await timed(() => readOnly(client => client.query(scope.text, scope.values)));
  return {
    scopeMs,
    countMs: await timed(() => own(client => count(statements, client))),
    pageIdsMs: await timed(() => own(client => pageIds(statements, client))),
    priceMs: await timed(() => own(client => priceIds(statements, client))),
  };
}

try {
  console.log(`load average at start: ${load()}; LISTING_STOCK_SCOPE_MAX_IDS=${process.env.LISTING_STOCK_SCOPE_MAX_IDS ?? ""} (blank: 30000)`);
  const results: { scope: string; rows: number; page: number; scoped: boolean; scopeReads: number; passes: Record<Side, Timing>[] }[] = [];
  for (const scope of scopes) {
    const { query, context } = parseScope(scope);
    const build = async (at: number): Promise<Record<Side, Built>> => ({
      whole: await built("0", () => inRequest(() => stockListingStatements(query, at, context))),
      scoped: await built(undefined, () => inRequest(() => stockListingStatements(query, at, context))),
    });
    let at = page, sides = await build(at);
    let rows = await sameOnOneSnapshot(scope, sides);
    // A page past the listing's end reads the last one (browseProducts' clamp, 24 cards a page), not an empty page.
    const last = Math.max(1, Math.ceil(rows / 24));
    if (at > last) {
      at = last;
      sides = await build(at);
      rows = await sameOnOneSnapshot(scope, sides);
    }
    const scoped = sides.scoped.count.text !== sides.whole.count.text;
    const done: Record<Side, Timing>[] = [];
    for (let pass = 1; pass <= passes; pass++) {
      // Alternating order: neither side always gets the other's warm cache.
      const order: Side[] = pass % 2 === 1 ? ["whole", "scoped"] : ["scoped", "whole"];
      const loadBefore = load();
      const row = {} as Record<Side, Timing>;
      for (const side of order) row[side] = await timings(sides[side]);
      done.push(row);
      console.log(JSON.stringify({ scope, page: at, pass, order: order.join(","), load: loadBefore, ...row }));
    }
    results.push({ scope, rows, page: at, scoped, scopeReads: sides.scoped.scopes.length, passes: done });
  }
  console.log(`load average at end: ${load()}`);
  console.log("\n| scope | rows | page | scoped | scope read | count whole | count scoped | page ids whole | page ids scoped | price page whole | price page scoped |");
  console.log("|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const { scope, rows, page: at, scoped, scopeReads, passes: done } of results) {
    const pick = (side: Side, field: keyof Timing) => `${median(done.map(pass => pass[side][field]))} ms`;
    const scopeRead = scopeReads ? pick("scoped", "scopeMs") : "-";
    console.log(`| ${scope} | ${rows} | ${at} | ${scoped ? "yes" : "no"} | ${scopeRead} | ${pick("whole", "countMs")} | ${pick("scoped", "countMs")} | ${pick("whole", "pageIdsMs")} | ${pick("scoped", "pageIdsMs")} | ${pick("whole", "priceMs")} | ${pick("scoped", "priceMs")} |`);
  }
  console.log(`(medians of ${passes} passes; "whole": LISTING_STOCK_SCOPE_MAX_IDS=0; page ids in the default order and the price-asc page at the page column, the price page's listed-id read included; "scope read": the scoped side's stock scope read, cached in the app, "-" without one; equality checked on one snapshot before the passes)`);
} finally {
  await db.end();
}
