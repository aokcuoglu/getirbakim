import { Pool } from "pg";
import { z } from "zod";
import { BasbugImportError, importBasbug } from "../src/modules/suppliers/basbug-import";
import { DinamikImportError, discoverDinamikBrands, dinamikBrandPattern, importDinamik } from "../src/modules/suppliers/dinamik-import";
import { pruneSupplierHistory } from "../src/modules/suppliers/sync";

// Invoke every 15 minutes. Due scopes choose their own interval (default: once a day).
// Manual run: --force [--supplier=basbug|dinamik] [--group=FIAT,AV] [--mode=full|commerce] ignores schedule and enabled flags.
const args = z.object({
  force: z.literal(true).optional(),
  supplier: z.enum(["basbug", "dinamik"]).optional(),
  group: z.string().transform(value => value.split(",")).pipe(z.array(z.string().regex(dinamikBrandPattern))).optional(),
  mode: z.enum(["full", "commerce"]).optional(),
}).strict().parse(Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z]+)(?:=(.+))?$/.exec(arg);
  if (!match) throw new Error("Use --force, --group=A,B or --mode=full|commerce");
  return [match[1], match[2] ?? true];
})));
if ((args.group || args.mode || args.supplier) && !args.force) throw new Error("--supplier, --group and --mode require --force");
if (args.supplier === "dinamik" && args.mode === "commerce") throw new Error("Dinamik has no separate price/stock run; use full");
const forcedSupplier = args.supplier ?? "basbug";
const dinamikConfigured = ["DINAMIK_BASE", "DINAMIK_APIKEY", "DINAMIK_SECRETKEY"].every(key => Boolean(process.env[key]));
// ~790 brands do not fit one tick next to Başbuğ's 30-minute price runs: start new brands only within
// this budget and leave the rest due for the following ticks. Forced runs are not limited.
const dinamikBudgetMs = z.coerce.number().positive().max(80).parse(process.env.DINAMIK_TICK_MINUTES || 10) * 60_000;
// These failures say the supplier itself is unreachable or occupied; trying the remaining groups now only adds load.
const stopReasons = new Set(["upstream", "config", "busy", "paused"]);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const worker = await pool.connect();
let locked = false;
let heartbeatStarted = false;
try {
  const database = (await worker.query("SELECT current_database() AS name,current_user AS owner")).rows[0];
  if (database.name !== "getirbakim" || database.owner !== "getirbakim_app") throw new Error("Independent database check failed");
  locked = (await worker.query("SELECT pg_try_advisory_lock(20261001,2) AS locked")).rows[0].locked;
  if (!locked) { console.log("Another scheduler is running; skipped."); if (args.force) process.exitCode = 1; }
  else {
    if (!(await worker.query("SELECT 1 FROM supplier_sync_migrations WHERE name='current-items-v1'")).rowCount) throw new Error("Run db:supplier:migrate first");
    await worker.query(`INSERT INTO supplier_scheduler_health(id,started_at,finished_at,succeeded)
      VALUES(true,clock_timestamp(),NULL,NULL) ON CONFLICT(id) DO UPDATE SET started_at=EXCLUDED.started_at,finished_at=NULL,succeeded=NULL`);
    heartbeatStarted = true;
    // Brand list refresh: once a day, and before a forced full Dinamik run over all brands.
    if (dinamikConfigured && (args.force ? forcedSupplier === "dinamik" && !args.group : !(await worker.query(
      "SELECT 1 FROM supplier_discovery WHERE supplier='dinamik' AND checked_at>now()-interval '1 day'")).rowCount)) {
      try {
        const discovery = await discoverDinamikBrands(pool);
        console.log({ dinamikBrands: discovery.listed, added: discovery.added.length, disabled: discovery.disabled, invalid: discovery.invalid });
      } catch (error) {
        console.error({ dinamikBrands: "failed", reason: error instanceof DinamikImportError ? error.message : "upstream" });
        process.exitCode = 1;
      }
    }
    const scopes = (await worker.query<{ supplier: string; company: string; list_group: string; warehouse: string; enabled:boolean; next_run_at:Date }>(
      args.force ? "SELECT * FROM supplier_sync_scopes WHERE supplier=$2 AND ($1::text[] IS NULL OR list_group=ANY($1)) AND ($1::text[] IS NOT NULL OR $2='basbug' OR enabled) ORDER BY list_group"
        // Başbuğ first: its price/stock runs are what checkout depends on.
        : "SELECT * FROM supplier_sync_scopes WHERE (enabled AND next_run_at<=now()) OR (commerce_enabled AND commerce_next_run_at<=now()) ORDER BY supplier<>'basbug',next_run_at,supplier,list_group",
      args.force ? [args.group ?? null, forcedSupplier] : [],
    )).rows;
    const unknown = args.group?.filter(group => !scopes.some(scope => scope.list_group === group));
    if (unknown?.length) { console.error({ unknownGroups: unknown }); process.exitCode = 1; }
    let catalogWordsChanged = false;
    const tickStarted = Date.now();
    const circuitOpen = new Set<string>();
    for (const [index, scope] of scopes.entries()) {
      if (circuitOpen.has(scope.supplier)) continue;
      const started = Date.now();
      if (scope.supplier === "dinamik") {
        if (!args.force && started - tickStarted > dinamikBudgetMs) {
          console.log({ dinamikDeferred: scopes.slice(index).filter(next => next.supplier === "dinamik").length });
          break;
        }
        try {
          const result = await importDinamik(pool, { brand: scope.list_group });
          console.log({ supplier: "dinamik", brand: scope.list_group, seconds: Math.round((Date.now() - started) / 1000), products: result.uniqueProducts, stats: result.stats });
        } catch (error) {
          const reason = error instanceof DinamikImportError ? error.message : "Dinamik import failed";
          console.error({ supplier: "dinamik", brand: scope.list_group, reason, seconds: Math.round((Date.now() - started) / 1000) });
          process.exitCode = 1;
          if (error instanceof DinamikImportError && stopReasons.has(error.reason)) {
            circuitOpen.add("dinamik");
            console.error({ circuitOpen: error.reason, supplier: "dinamik", skipped: scopes.slice(index + 1).filter(next => next.supplier === "dinamik").length });
          }
        }
        continue;
      }
      try {
        if (scope.supplier !== "basbug" || scope.warehouse !== "MRK") throw new Error("No verified adapter for scope");
        const mode = args.mode ?? (args.force || (scope.enabled && scope.next_run_at.getTime() <= Date.now()) ? "full" : "commerce");
        const result = await importBasbug(pool, { group: scope.list_group, warehouse: "MRK", company: scope.company, mode });
        console.log({ group: scope.list_group, mode, seconds: Math.round((Date.now() - started) / 1000), products: result.uniqueProducts, stats: result.stats });
        // Only full imports carry product names; price/stock runs leave the search vocabulary as is.
        if (mode === "full" && result.stats.added + result.stats.changed + result.stats.restored > 0) catalogWordsChanged = true;
      } catch (error) {
        const reason = error instanceof BasbugImportError ? error.message : "No verified adapter for scope";
        console.error({ group: scope.list_group, reason, seconds: Math.round((Date.now() - started) / 1000) });
        process.exitCode = 1;
        if (error instanceof BasbugImportError && stopReasons.has(error.reason)) {
          circuitOpen.add("basbug");
          const skipped = scopes.slice(index + 1).filter(next => next.supplier === "basbug").map(next => next.list_group);
          if (skipped.length) console.error({ circuitOpen: error.reason, skipped });
        }
      }
    }
    if (catalogWordsChanged) {
      // "Did you mean" suggestions only know words already in search_vocabulary (db/search.sql).
      // A failed refresh keeps yesterday's words, so it is reported but does not fail the scheduler.
      const started = Date.now();
      try {
        await worker.query("SELECT refresh_search_vocabulary()");
        console.log({ searchVocabulary: "refreshed", seconds: Math.round((Date.now() - started) / 1000) });
      } catch (error) { console.error({ searchVocabulary: "failed", code: (error as { code?: string }).code }); }
    }
    await worker.query("BEGIN");
    try {
      console.log({ retention: await pruneSupplierHistory(worker) });
      await worker.query("COMMIT");
    } catch (error) { await worker.query("ROLLBACK"); throw error; }
    const alerts = (await worker.query(`SELECT supplier,company,list_group,warehouse,consecutive_failures,last_success_at
      FROM supplier_sync_scopes WHERE (enabled AND (consecutive_failures>0 OR last_success_at IS NULL
      OR last_success_at<now()-stale_minutes*interval '1 minute')) OR (commerce_enabled AND
      (commerce_failures>0 OR commerce_last_success_at IS NULL OR commerce_last_success_at<now()-commerce_stale_minutes*interval '1 minute'))`)).rows;
    if (alerts.length) { console.error({ alerts }); process.exitCode = 1; }
  }
} catch {
  process.exitCode = 1;
  console.error("Supplier scheduler failed; check database, configuration and migration status.");
} finally {
  try {
  if (heartbeatStarted) await worker.query("UPDATE supplier_scheduler_health SET finished_at=clock_timestamp(),succeeded=$1 WHERE id=true", [!process.exitCode]);
  } finally {
  try { if (locked) await worker.query("SELECT pg_advisory_unlock(20261001,2)"); }
  finally { worker.release(); await pool.end(); }
  }
}
