import { Pool } from "pg";
import { z } from "zod";
import { BasbugImportError, importBasbug } from "../src/modules/suppliers/basbug-import";
import { nextDinamikBreaker } from "../src/modules/suppliers/dinamik-breaker";
import { DinamikImportError, discoverDinamikBrands, dinamikBrandPattern, importDinamik } from "../src/modules/suppliers/dinamik-import";
import { SetaImportError, importSeta, setaScope } from "../src/modules/suppliers/seta-import";
import { supplierSyncAlerts } from "../src/modules/suppliers/health";
import { refreshPriceAnomalies } from "../src/modules/suppliers/price-anomalies";
import { refreshProductMatchesIfDue } from "../src/modules/suppliers/product-match-schedule";
import { pruneSupplierHistory } from "../src/modules/suppliers/sync";

// Invoke every 15 minutes. Due scopes choose their own interval (default: once a day).
// Manual run: --force [--supplier=basbug|dinamik|seta] [--group=FIAT,AV] [--mode=full|commerce] ignores schedule and enabled flags.
const args = z.object({
  force: z.literal(true).optional(),
  supplier: z.enum(["basbug", "dinamik", "seta"]).optional(),
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
// Dinamik decides per brand in nextDinamikBreaker (#1071): one brand's 5xx or timeout does not stop the others.
const stopReasons = new Set(["upstream", "config", "busy", "paused"]);

// Peak resident memory of this run so far; the sync worker's limits come from these numbers (#253, #277).
const peakRssMB = () => Math.round(process.resourceUsage().maxRSS / 1024);
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
        console.log({ dinamikBrands: discovery.listed, added: discovery.added.length, reenabled: discovery.reenabled, disabled: discovery.disabled, retired: discovery.retired, invalid: discovery.invalid });
      } catch (error) {
        console.error({ dinamikBrands: "failed", reason: error instanceof DinamikImportError ? error.message : "upstream" });
        process.exitCode = 1;
      }
    }
    const scopes = (await worker.query<{ supplier: string; company: string; list_group: string; warehouse: string; enabled:boolean; next_run_at:Date }>(
      args.force ? "SELECT * FROM supplier_sync_scopes WHERE supplier=$2 AND ($1::text[] IS NULL OR list_group=ANY($1)) AND ($1::text[] IS NOT NULL OR $2<>'dinamik' OR enabled) ORDER BY list_group"
        // Dinamik last: its brands only start within a time budget, and stopping there must not skip other suppliers.
        : "SELECT * FROM supplier_sync_scopes WHERE (enabled AND next_run_at<=now()) OR (commerce_enabled AND commerce_next_run_at<=now()) ORDER BY supplier='dinamik',next_run_at,supplier,list_group",
      args.force ? [args.group ?? null, forcedSupplier] : [],
    )).rows;
    // SETA's single scope is created by its first successful import; a forced run may be that first import.
    if (args.force && args.supplier === "seta" && !scopes.length && !args.group)
      scopes.push({ supplier: "seta", company: setaScope.company, list_group: setaScope.group, warehouse: setaScope.warehouse, enabled: true, next_run_at: new Date() });
    const unknown = args.group?.filter(group => !scopes.some(scope => scope.list_group === group));
    if (unknown?.length) { console.error({ unknownGroups: unknown }); process.exitCode = 1; }
    let catalogWordsChanged = false;
    // A row's currency only changes with a full list (basbug-import.ts), so anomalies are re-detected after one (#1030).
    let basbugFullSucceeded = false;
    const tickStarted = Date.now();
    const circuitOpen = new Set<string>();
    let dinamikFailures = 0;
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
          console.log({ supplier: "dinamik", brand: scope.list_group, seconds: Math.round((Date.now() - started) / 1000), products: result.uniqueProducts, stats: result.stats, peakRssMB: peakRssMB() });
          // Dinamik names are sold and searched on the storefront too.
          if (result.stats.added + result.stats.changed + result.stats.restored > 0) catalogWordsChanged = true;
          dinamikFailures = nextDinamikBreaker(dinamikFailures, { ok: true }).failures;
        } catch (error) {
          const reason = error instanceof DinamikImportError ? error.message : "Dinamik import failed";
          console.error({ supplier: "dinamik", brand: scope.list_group, reason, seconds: Math.round((Date.now() - started) / 1000) });
          process.exitCode = 1;
          if (!(error instanceof DinamikImportError)) continue;
          const breaker = nextDinamikBreaker(dinamikFailures, { ok: false, reason: error.reason, detail: error.detail });
          dinamikFailures = breaker.failures;
          if (breaker.open) {
            circuitOpen.add("dinamik");
            console.error({ circuitOpen: error.reason, supplier: "dinamik", skipped: scopes.slice(index + 1).filter(next => next.supplier === "dinamik").length });
          }
        }
        continue;
      }
      const mode = args.mode ?? (args.force || (scope.enabled && scope.next_run_at.getTime() <= Date.now()) ? "full" : "commerce");
      if (scope.supplier === "seta") {
        try {
          const result = await importSeta(pool, { mode });
          console.log({ supplier: "seta", mode, seconds: Math.round((Date.now() - started) / 1000), products: result.uniqueProducts, stats: result.stats, peakRssMB: peakRssMB() });
          if (mode === "full" && result.stats.added + result.stats.changed + result.stats.restored > 0) catalogWordsChanged = true;
        } catch (error) {
          console.error({ supplier: "seta", mode, reason: error instanceof SetaImportError ? error.message : "SETA import failed", seconds: Math.round((Date.now() - started) / 1000) });
          process.exitCode = 1;
        }
        continue;
      }
      try {
        if (scope.supplier !== "basbug" || scope.warehouse !== "MRK") throw new Error("No verified adapter for scope");
        const result = await importBasbug(pool, { group: scope.list_group, warehouse: "MRK", company: scope.company, mode });
        console.log({ group: scope.list_group, mode, seconds: Math.round((Date.now() - started) / 1000), products: result.uniqueProducts, stats: result.stats, peakRssMB: peakRssMB() });
        if (mode === "full") basbugFullSucceeded = true;
        // Only full imports carry product names; price/stock runs leave the search vocabulary as is.
        if (mode === "full" && result.stats.added + result.stats.changed + result.stats.restored > 0) catalogWordsChanged = true;
      } catch (error) {
        const reason = error instanceof BasbugImportError ? error.message : "No verified adapter for scope";
        console.error({ group: scope.list_group, reason, seconds: Math.round((Date.now() - started) / 1000) });
        process.exitCode = 1;
        // Only Başbuğ's remaining groups are skipped; other suppliers do not share its outage.
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
    // Single-row currency anomalies (#1030): a failed refresh keeps the previous list and does not fail the scheduler.
    if (basbugFullSucceeded) {
      try { console.log({ priceAnomalies: await refreshPriceAnomalies(pool, "basbug") }); }
      catch (error) { console.error({ priceAnomalies: "failed", code: (error as { code?: string }).code }); }
    }
    // New brand labels and products reach the master catalog only through this refresh (~1–2 min); scheduled ticks run
    // it after supplier changes at most every PRODUCT_MATCH_INTERVAL_HOURS. Forced runs (admin refresh) leave it to them.
    if (!args.force) {
      const match = await refreshProductMatchesIfDue(worker);
      if (match.productMatch === "failed") console.error(match);
      else if (match.productMatch === "refreshed") console.log(match);
    }
    await worker.query("BEGIN");
    try {
      console.log({ retention: await pruneSupplierHistory(worker),
        restockRequests: (await worker.query<{ pruned: unknown }>("SELECT prune_restock_requests() AS pruned")).rows[0].pruned });
      await worker.query("COMMIT");
    } catch (error) { await worker.query("ROLLBACK"); throw error; }
    const alerts = await supplierSyncAlerts(worker);
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
