import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { loadavg } from "node:os";
import type { PoolClient, QueryResultRow } from "pg";

// npm run catalog:listing-timings -- [--explain] [--passes=N] [--work-mem=16MB] <scope>... (#1367). Read-only: every
// statement runs in a READ ONLY transaction that is rolled back, and nothing goes through the listing caches (no
// storefront_listing_cache write). Compares a listing's four reads (count, page-1 ids, brands, property facet) with the
// one-scan summary that replaces them:
// - equality: both sides on one REPEATABLE READ snapshot, so a supplier sync running meanwhile cannot tell them apart;
// - wall time: the four side by side (as a page starts them) against the summary, the side that runs first alternating
//   per pass;
// - --explain: EXPLAIN (ANALYZE, BUFFERS) of each statement, one after another: execution and planning time, temp blocks
//   written, and whether the summary's `scoped` read keeps a parallel Gather.
// A scope is `katalog` (every listed product) or `key=value` pairs joined by `&`, keys manufacturer, make, model and
// category: `manufacturer=orijinal`, `make=volkswagen`, `category=fren&make=volkswagen`.
process.env.LISTING_CACHE_PERSIST = "0";
const args = process.argv.slice(2);
const flags = new Map(args.filter(arg => arg.startsWith("--")).map(arg => {
  const [name, value = "true"] = arg.slice(2).split("=");
  return [name, value];
}));
const unknownFlags = [...flags.keys()].filter(name => !["explain", "passes", "work-mem"].includes(name));
if (unknownFlags.length) throw new Error(`Unknown flags: ${unknownFlags.join(" ")} (expected --explain, --passes=N, --work-mem=16MB)`);
const passes = Number(flags.get("passes") ?? 3);
if (!Number.isSafeInteger(passes) || passes < 1) throw new Error("--passes must be a positive integer");
const workMem = flags.get("work-mem");
if (workMem !== undefined && !/^\d+(kB|MB)$/.test(workMem)) throw new Error(`Invalid --work-mem: ${workMem}`);
const explained = flags.has("explain");
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
const { listingStatements } = await import("../src/modules/store/catalog");

type Statement = { text: string; values: unknown[] };
type Statements = Awaited<ReturnType<typeof listingStatements>>;
type Facet = { key: string; values: string[] };
type Values = { count: number; ids: string[]; brands: string[]; attributes: Facet[] };
type Plan = { "Node Type": string; "Subplan Name"?: string; "Temp Written Blocks"?: number; "Workers Launched"?: number; Plans?: Plan[] };
type Explained = { "Execution Time": number; "Planning Time": number; Plan: Plan };

/** Runs `read` on its own client inside a READ ONLY transaction (with --work-mem), always rolled back. */
async function readOnly<T>(read: (client: PoolClient) => Promise<T>, isolation = "READ COMMITTED"): Promise<T> {
  const client = await db.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation} READ ONLY`);
    await client.query("SET LOCAL statement_timeout = 300000");
    if (workMem) await client.query(`SET LOCAL work_mem = '${workMem}'`);
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
async function explain(statement: Statement) {
  const result = await readOnly(client => client.query<{ "QUERY PLAN": Explained[] }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`, statement.values));
  return result.rows[0]["QUERY PLAN"][0];
}
const walk = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(walk)];
/** Whether the materialized `scoped` read runs under a Gather, and with how many launched workers. */
function scopedGather(plan: Plan) {
  const scoped = walk(plan).find(node => node["Subplan Name"] === "CTE scoped");
  const gathers = scoped ? walk(scoped).filter(node => node["Node Type"].startsWith("Gather")) : [];
  return gathers.length ? `${gathers[0]["Node Type"]} (${gathers.map(node => node["Workers Launched"] ?? 0).join("+")} workers)` : "none";
}
const load = () => loadavg().map(value => value.toFixed(1)).join(" ");
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fourReads = (statements: Statements) => [statements.count, statements.pageIds, statements.brands, statements.attributes];

type Pass = { legacyWallMs: number; summaryWallMs: number; legacyExecMs?: number; legacyPlanMs?: number; summaryExecMs?: number; summaryPlanMs?: number; legacyTemp?: number; summaryTemp?: number; gather?: string };
const results: { scope: string; count: number; passes: Pass[] }[] = [];
try {
  console.log(`load average at start: ${load()}${workMem ? `, work_mem ${workMem}` : ""}`);
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
} finally {
  await db.end();
}
