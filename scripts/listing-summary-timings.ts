import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { loadavg } from "node:os";
import pg, { type PoolClient, type QueryResultRow } from "pg";

// npm run catalog:listing-timings -- [--explain] [--passes=N] [--work-mem=16MB] [--price-order=price-asc|price-desc --page=N] <scope>...
// (#1367, #1369). Read-only: every statement runs in a READ ONLY transaction that is rolled back, and nothing goes through
// the listing caches (no storefront_listing_cache or storefront_listing_price_orders write). The one exception is
// --price-order's probe below, a read-write transaction that is always rolled back and writes only a temporary table.
// Compares a listing's four reads (count, page-1 ids, brands, property facet) with the one-scan summary that replaces them:
// - equality: both sides on one REPEATABLE READ snapshot, so a supplier sync running meanwhile cannot tell them apart;
// - wall time: the four side by side (as a page starts them) against the summary, the side that runs first alternating
//   per pass;
// - --explain: EXPLAIN (ANALYZE, BUFFERS) of each statement, one after another: execution and planning time, temp blocks
//   written, and whether the summary's `scoped` read keeps a parallel Gather.
// With --price-order (#1369) it compares a deep price-sorted page (--page, default 57) read live with the listing's whole
// stored order a deep page slices instead (src/modules/store/listing-price-order.ts):
// - equality: on one REPEATABLE READ snapshot the order's slice for the page holds the live page's ids;
// - wall time of the live page (at --work-mem) and of the order (at the build's work_mem), the first alternating per pass;
// - --explain: execution time, sort method, temp blocks written and parallel Gather of both;
// - the probe: the order written into a temporary table (pg_temp, ON COMMIT DROP; a data-modifying statement plans
//   without parallel workers, as the build does), its stored size, and the page's slice read back from it.
// A scope is `katalog` (every listed product) or `key=value` pairs joined by `&`, keys manufacturer, make, model and
// category: `manufacturer=orijinal`, `make=volkswagen`, `category=fren&make=volkswagen`.
process.env.LISTING_CACHE_PERSIST = "0";
const args = process.argv.slice(2);
const flags = new Map(args.filter(arg => arg.startsWith("--")).map(arg => {
  const [name, value = "true"] = arg.slice(2).split("=");
  return [name, value];
}));
const unknownFlags = [...flags.keys()].filter(name => !["explain", "passes", "work-mem", "price-order", "page"].includes(name));
if (unknownFlags.length) throw new Error(`Unknown flags: ${unknownFlags.join(" ")} (expected --explain, --passes=N, --work-mem=16MB, --price-order=price-asc|price-desc, --page=N)`);
const passes = Number(flags.get("passes") ?? 3);
if (!Number.isSafeInteger(passes) || passes < 1) throw new Error("--passes must be a positive integer");
const workMem = flags.get("work-mem");
if (workMem !== undefined && !/^\d+(kB|MB)$/.test(workMem)) throw new Error(`Invalid --work-mem: ${workMem}`);
const explained = flags.has("explain");
const priceSortFlag = flags.get("price-order");
if (priceSortFlag !== undefined && priceSortFlag !== "price-asc" && priceSortFlag !== "price-desc") throw new Error("--price-order must be price-asc or price-desc");
const priceSort = priceSortFlag as "price-asc" | "price-desc" | undefined;
if (flags.has("page") && !priceSort) throw new Error("--page needs --price-order");
const page = Number(flags.get("page") ?? 57);
if (!Number.isSafeInteger(page) || page < 1) throw new Error("--page must be a positive integer");
const scopes = args.filter(arg => !arg.startsWith("--"));
if (!scopes.length) throw new Error("Name at least one scope: katalog, manufacturer=orijinal, make=volkswagen, category=fren …");
const scopeKeys = new Set(["manufacturer", "make", "model", "category"]);
function parseScope(scope: string) {
  if (scope === "katalog") return {};
  const query = Object.fromEntries(new URLSearchParams(scope));
  const unknown = Object.keys(query).filter(key => !scopeKeys.has(key));
  if (unknown.length || !Object.keys(query).length) throw new Error(`Invalid scope ${scope}: use katalog or manufacturer|make|model|category=<slug>`);
  return query;
}

// The category tree calls connection(), which needs a request scope: a static work store lets it run. Next reads the
// global AsyncLocalStorage when its storage module loads, so it is set before the imports below.
Object.assign(globalThis, { AsyncLocalStorage });
const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
const inRequest = <T>(run: () => Promise<T>) => workAsyncStorage.run({ route: "/listing-timings", forceStatic: true } as Parameters<typeof workAsyncStorage.run>[0], run);
const { db } = await import("../src/lib/db");
const { listingStatements, priceOrderStatements } = await import("../src/modules/store/catalog");
const { priceOrderWorkMem } = await import("../src/modules/store/listing-price-order");

type Statement = { text: string; values: unknown[] };
type Statements = Awaited<ReturnType<typeof listingStatements>>;
type Facet = { key: string; values: string[] };
type Values = { count: number; ids: string[]; brands: string[]; attributes: Facet[] };
type Plan = {
  "Node Type": string; "Subplan Name"?: string; "Temp Written Blocks"?: number; "Workers Launched"?: number; Plans?: Plan[];
  "Sort Method"?: string; "Sort Space Used"?: number; "Sort Space Type"?: string;
};
type Explained = { "Execution Time": number; "Planning Time": number; Plan: Plan };

/** Runs `read` on its own client inside a READ ONLY transaction (with `mem`, --work-mem by default), always rolled back. */
async function readOnly<T>(read: (client: PoolClient) => Promise<T>, isolation = "READ COMMITTED", mem = workMem): Promise<T> {
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
/** The four reads' values: on `client`, one after another; without, side by side on their own clients. */
async function legacyValues(statements: Statements, client?: PoolClient): Promise<Values> {
  const on = <T extends QueryResultRow>(statement: Statement) => client ? client.query<T>(statement.text, statement.values).then(result => result.rows)
    : readOnly(own => own.query<T>(statement.text, statement.values).then(result => result.rows));
  const reads = [() => on<{ count: string }>(statements.count), () => on<{ id: string }>(statements.pageIds),
    () => on<{ brand: string }>(statements.brands), () => on<Facet>(statements.attributes)] as const;
  const [count, ids, brands, attributes] = client
    ? [await reads[0](), await reads[1](), await reads[2](), await reads[3]()] as const
    : await Promise.all([reads[0](), reads[1](), reads[2](), reads[3]()]);
  return { count: Number(count[0].count), ids: ids.map(row => row.id), brands: brands.map(row => row.brand), attributes: attributes.map(row => ({ key: row.key, values: row.values })) };
}
async function summaryValues(statement: Statement, client?: PoolClient): Promise<Values> {
  const read = (own: PoolClient) => own.query<{ count: string; ids: string[]; brands: string[]; attributes: Facet[] }>(statement.text, statement.values);
  const [row] = (await (client ? read(client) : readOnly(read))).rows;
  return { count: Number(row.count), ids: row.ids, brands: row.brands, attributes: row.attributes };
}
/** Both sides on one snapshot: the summary must give exactly the four reads' values. Returns the listing's count. */
async function sameOnOneSnapshot(scope: string, statements: Statements) {
  return readOnly(async client => {
    const old = await legacyValues(statements, client), one = await summaryValues(statements.summary, client);
    assert.deepEqual(one, old, `${scope}: the summary differs from the four reads`);
    return one.count;
  }, "REPEATABLE READ");
}
async function timed(run: () => Promise<unknown>) {
  const started = performance.now();
  await run();
  return Math.round(performance.now() - started);
}
async function explain(statement: Statement, mem = workMem) {
  const result = await readOnly(client => client.query<{ "QUERY PLAN": Explained[] }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`, statement.values), "READ COMMITTED", mem);
  return result.rows[0]["QUERY PLAN"][0];
}
const walk = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(walk)];
/** The launched Gather nodes under `plan`: node type and workers launched, "none" without. */
function gathers(plan: Plan) {
  const found = walk(plan).filter(node => node["Node Type"].startsWith("Gather"));
  return found.length ? `${found[0]["Node Type"]} (${found.map(node => node["Workers Launched"] ?? 0).join("+")} workers)` : "none";
}
/** Whether the materialized `scoped` read runs under a Gather, and with how many launched workers. */
function scopedGather(plan: Plan) {
  const scoped = walk(plan).find(node => node["Subplan Name"] === "CTE scoped");
  return scoped ? gathers(scoped) : "none";
}
/** Every sort of the plan: its method and space ("top-N heapsort 30 kB Memory"). */
const sorts = (plan: Plan) => walk(plan).filter(node => node["Sort Method"]).map(node => `${node["Sort Method"]} ${node["Sort Space Used"]} kB ${node["Sort Space Type"]}`).join(", ") || "none";
const load = () => loadavg().map(value => value.toFixed(1)).join(" ");
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fourReads = (statements: Statements) => [statements.count, statements.pageIds, statements.brands, statements.attributes];

type Pass = { legacyWallMs: number; summaryWallMs: number; legacyExecMs?: number; legacyPlanMs?: number; summaryExecMs?: number; summaryPlanMs?: number; legacyTemp?: number; summaryTemp?: number; gather?: string };
async function summaryTimings() {
  const results: { scope: string; count: number; passes: Pass[] }[] = [];
  for (const scope of scopes) {
    const statements = await inRequest(() => listingStatements(parseScope(scope)));
    const count = await sameOnOneSnapshot(scope, statements);
    const done: Pass[] = [];
    for (let pass = 1; pass <= passes; pass++) {
      // Alternating order: neither side always gets the other's warm cache.
      const legacyFirst = pass % 2 === 1;
      const loadBefore = load();
      const legacyWall = () => timed(() => legacyValues(statements)), summaryWall = () => timed(() => summaryValues(statements.summary));
      let legacyWallMs: number, summaryWallMs: number;
      if (legacyFirst) {
        legacyWallMs = await legacyWall();
        summaryWallMs = await summaryWall();
      } else {
        summaryWallMs = await summaryWall();
        legacyWallMs = await legacyWall();
      }
      const row: Pass = { legacyWallMs, summaryWallMs };
      if (explained) {
        // One after another, so each statement's time is its own; the order alternates like the wall times.
        const legacyPlans: Explained[] = [];
        const explainLegacy = async () => { for (const statement of fourReads(statements)) legacyPlans.push(await explain(statement)); };
        let summaryPlan: Explained;
        if (legacyFirst) {
          await explainLegacy();
          summaryPlan = await explain(statements.summary);
        } else {
          summaryPlan = await explain(statements.summary);
          await explainLegacy();
        }
        const sum = (pick: (plan: Explained) => number) => Math.round(legacyPlans.reduce((total, plan) => total + pick(plan), 0));
        Object.assign(row, {
          legacyExecMs: sum(plan => plan["Execution Time"]), legacyPlanMs: sum(plan => plan["Planning Time"]),
          summaryExecMs: Math.round(summaryPlan["Execution Time"]), summaryPlanMs: Math.round(summaryPlan["Planning Time"]),
          legacyTemp: sum(plan => plan.Plan["Temp Written Blocks"] ?? 0), summaryTemp: summaryPlan.Plan["Temp Written Blocks"] ?? 0,
          gather: scopedGather(summaryPlan.Plan),
        });
      }
      done.push(row);
      console.log(JSON.stringify({ scope, pass, order: legacyFirst ? "legacy,summary" : "summary,legacy", load: loadBefore, ...row }));
    }
    results.push({ scope, count, passes: done });
  }
  console.log(`load average at end: ${load()}`);
  console.log("\n| scope | rows | legacy wall (4 side by side) | summary wall | wall ratio | legacy exec sum | summary exec | exec ratio | temp blocks legacy / summary | scoped Gather |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const { scope, count, passes: done } of results) {
    const pick = (field: keyof Pass) => done.map(pass => Number(pass[field] ?? 0));
    const [legacyWall, summaryWall] = [median(pick("legacyWallMs")), median(pick("summaryWallMs"))];
    const [legacyExec, summaryExec] = [median(pick("legacyExecMs")), median(pick("summaryExecMs"))];
    const cells = explained ? [`${legacyExec} ms`, `${summaryExec} ms`, (summaryExec / legacyExec).toFixed(2), `${median(pick("legacyTemp"))} / ${median(pick("summaryTemp"))}`,
      [...new Set(done.map(pass => pass.gather))].join(", ")] : ["-", "-", "-", "-", "-"];
    console.log(`| ${scope} | ${count} | ${legacyWall} ms | ${summaryWall} ms | ${(summaryWall / legacyWall).toFixed(2)} | ${cells.join(" | ")} |`);
  }
  console.log(`(medians of ${passes} passes; the rows and the equality check come from one snapshot before the passes)`);
}

type OrderStatements = Awaited<ReturnType<typeof priceOrderStatements>>;
const pageSize = 24, offset = (page - 1) * pageSize;
/** The order's id count and the page's slice, read in SQL: a 900k-id array is not sent to the script. */
const orderSlice = (order: Statement): Statement => ({
  text: `SELECT cardinality(o.ids) AS total,o.ids[${offset + 1}:${offset + pageSize}]::text[] AS slice FROM (${order.text}) o`, values: order.values,
});
/** On one snapshot the stored order's slice for the page holds the live page's ids. Returns the order's id count. */
async function sameOrderOnOneSnapshot(scope: string, statements: OrderStatements) {
  return readOnly(async client => {
    const live = (await client.query<{ id: string }>(statements.livePage.text, statements.livePage.values)).rows.map(row => row.id);
    await client.query(`SET LOCAL work_mem = '${priceOrderWorkMem}'`);
    const sliced = orderSlice(statements.order);
    const [{ total, slice }] = (await client.query<{ total: number; slice: string[] }>(sliced.text, sliced.values)).rows;
    assert.ok(live.length > 0, `${scope}: page ${page} is empty`);
    assert.deepEqual(slice, live, `${scope}: the stored order's page ${page} differs from the live page`);
    return total;
  }, "REPEATABLE READ");
}
// The probe's own connection: temp_buffers can only be raised before the session first touches a temporary table, and
// the default 8 MB would hold a large order on disk where the listing table keeps it in shared buffers.
const probeClient = priceSort ? new pg.Client({ connectionString: process.env.DATABASE_URL }) : undefined;
/**
 * The build's write, into a temporary table instead of the listing table: the order written (timed; serial, as any
 * data-modifying statement), its stored size and the page's slice read back (EXPLAIN ANALYZE and wall). Rolled back.
 */
async function probe(statements: OrderStatements) {
  const client = probeClient!;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 300000");
    await client.query(`SET LOCAL work_mem = '${priceOrderWorkMem}'`);
    await client.query("CREATE TEMP TABLE price_order_probe(ids uuid[]) ON COMMIT DROP");
    const buildMs = await timed(() => client.query(`INSERT INTO price_order_probe(ids) ${statements.order.text}`, statements.order.values));
    const [{ bytes }] = (await client.query<{ bytes: number }>("SELECT pg_column_size(ids) AS bytes FROM price_order_probe")).rows;
    const slice = `SELECT ids[${offset + 1}:${offset + pageSize}]::text[] AS ids FROM price_order_probe`;
    const plan = (await client.query<{ "QUERY PLAN": Explained[] }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${slice}`)).rows[0]["QUERY PLAN"][0];
    const sliceWallMs = await timed(() => client.query(slice));
    return { buildMs, bytes, sliceExecMs: Math.round(plan["Execution Time"] * 10) / 10, sliceWallMs };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}
type OrderPass = {
  liveWallMs: number; orderWallMs: number; buildMs: number; bytes: number; sliceExecMs: number; sliceWallMs: number;
  liveExecMs?: number; liveSort?: string; liveTemp?: number; liveGather?: string;
  orderExecMs?: number; orderSort?: string; orderTemp?: number; orderGather?: string;
};
async function priceOrderTimings() {
  await probeClient!.connect();
  await probeClient!.query("SET temp_buffers = '256MB'");
  const results: { scope: string; total: number; passes: OrderPass[] }[] = [];
  for (const scope of scopes) {
    const statements = await inRequest(() => priceOrderStatements({ ...parseScope(scope), sort: priceSort }, page));
    const total = await sameOrderOnOneSnapshot(scope, statements);
    const done: OrderPass[] = [];
    for (let pass = 1; pass <= passes; pass++) {
      const liveFirst = pass % 2 === 1;
      const loadBefore = load();
      const counted: Statement = { text: `SELECT cardinality(o.ids) FROM (${statements.order.text}) o`, values: statements.order.values };
      const liveWall = () => timed(() => readOnly(client => client.query(statements.livePage.text, statements.livePage.values)));
      const orderWall = () => timed(() => readOnly(client => client.query(counted.text, counted.values), "READ COMMITTED", priceOrderWorkMem));
      let liveWallMs: number, orderWallMs: number;
      if (liveFirst) {
        liveWallMs = await liveWall();
        orderWallMs = await orderWall();
      } else {
        orderWallMs = await orderWall();
        liveWallMs = await liveWall();
      }
      const row: OrderPass = { liveWallMs, orderWallMs, ...await probe(statements) };
      if (explained) {
        const livePlan = await explain(statements.livePage), orderPlan = await explain(statements.order, priceOrderWorkMem);
        Object.assign(row, {
          liveExecMs: Math.round(livePlan["Execution Time"]), liveSort: sorts(livePlan.Plan), liveTemp: livePlan.Plan["Temp Written Blocks"] ?? 0, liveGather: gathers(livePlan.Plan),
          orderExecMs: Math.round(orderPlan["Execution Time"]), orderSort: sorts(orderPlan.Plan), orderTemp: orderPlan.Plan["Temp Written Blocks"] ?? 0, orderGather: gathers(orderPlan.Plan),
        });
      }
      done.push(row);
      console.log(JSON.stringify({ scope, sort: priceSort, page, pass, order: liveFirst ? "live,order" : "order,live", load: loadBefore, ...row }));
    }
    results.push({ scope, total, passes: done });
  }
  console.log(`load average at end: ${load()}`);
  console.log(`\n| scope | sort | page | ids | live page wall | order wall | build (INSERT, serial) | array bytes | slice exec | slice wall | live exec | live sort | live temp | live Gather | order exec | order sort | order temp | order Gather |`);
  console.log("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---:|---|---:|---|");
  for (const { scope, total, passes: done } of results) {
    const pick = (field: keyof OrderPass) => median(done.map(pass => Number(pass[field] ?? 0)));
    const each = (field: keyof OrderPass) => [...new Set(done.map(pass => String(pass[field] ?? "-")))].join(" / ");
    const explainedCells = explained ? [`${pick("liveExecMs")} ms`, each("liveSort"), pick("liveTemp"), each("liveGather"), `${pick("orderExecMs")} ms`, each("orderSort"), pick("orderTemp"), each("orderGather")]
      : ["-", "-", "-", "-", "-", "-", "-", "-"];
    console.log(`| ${scope} | ${priceSort} | ${page} | ${total} | ${pick("liveWallMs")} ms | ${pick("orderWallMs")} ms | ${pick("buildMs")} ms | ${pick("bytes")} | ${pick("sliceExecMs")} ms | ${pick("sliceWallMs")} ms | ${explainedCells.join(" | ")} |`);
  }
  console.log(`(medians of ${passes} passes; live page at work_mem ${workMem ?? "session default"}, order and build at ${priceOrderWorkMem}; equality checked on one snapshot before the passes)`);
}

try {
  console.log(`load average at start: ${load()}${workMem ? `, work_mem ${workMem}` : ""}`);
  if (priceSort) await priceOrderTimings();
  else await summaryTimings();
} finally {
  await probeClient?.end().catch(() => {});
  await db.end();
}
