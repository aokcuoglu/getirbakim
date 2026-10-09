import { Pool } from "pg";
import { z } from "zod";
import { BasbugImportError, importBasbug } from "../src/modules/suppliers/basbug-import";
import { pruneSupplierHistory } from "../src/modules/suppliers/sync";

// Invoke every 15 minutes. Due scopes choose their own interval (default: once a day).
// Manual run: --force [--group=FIAT,AV] [--mode=full|commerce] ignores schedule and enabled flags.
const args = z.object({
  force: z.literal(true).optional(),
  group: z.string().regex(/^[A-Z0-9_-]{1,30}(,[A-Z0-9_-]{1,30})*$/).transform(value => value.split(",")).optional(),
  mode: z.enum(["full", "commerce"]).optional(),
}).strict().parse(Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z]+)(?:=(.+))?$/.exec(arg);
  if (!match) throw new Error("Use --force, --group=A,B or --mode=full|commerce");
  return [match[1], match[2] ?? true];
})));
if ((args.group || args.mode) && !args.force) throw new Error("--group and --mode require --force");
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
    const scopes = (await worker.query<{ supplier: string; company: string; list_group: string; warehouse: string; enabled:boolean; next_run_at:Date }>(
      args.force ? "SELECT * FROM supplier_sync_scopes WHERE supplier='basbug' AND ($1::text[] IS NULL OR list_group=ANY($1)) ORDER BY list_group"
        : "SELECT * FROM supplier_sync_scopes WHERE (enabled AND next_run_at<=now()) OR (commerce_enabled AND commerce_next_run_at<=now()) ORDER BY next_run_at,supplier,list_group",
      args.force ? [args.group ?? null] : [],
    )).rows;
    const unknown = args.group?.filter(group => !scopes.some(scope => scope.list_group === group));
    if (unknown?.length) { console.error({ unknownGroups: unknown }); process.exitCode = 1; }
    for (const [index, scope] of scopes.entries()) {
      const started = Date.now();
      try {
        if (scope.supplier !== "basbug" || scope.warehouse !== "MRK") throw new Error("No verified adapter for scope");
        const mode = args.mode ?? (args.force || (scope.enabled && scope.next_run_at.getTime() <= Date.now()) ? "full" : "commerce");
        const result = await importBasbug(pool, { group: scope.list_group, warehouse: "MRK", company: scope.company, mode });
        console.log({ group: scope.list_group, mode, seconds: Math.round((Date.now() - started) / 1000), products: result.uniqueProducts, stats: result.stats });
      } catch (error) {
        const reason = error instanceof BasbugImportError ? error.message : "No verified adapter for scope";
        console.error({ group: scope.list_group, reason, seconds: Math.round((Date.now() - started) / 1000) });
        process.exitCode = 1;
        if (error instanceof BasbugImportError && stopReasons.has(error.reason)) {
          const skipped = scopes.slice(index + 1).map(next => next.list_group);
          if (skipped.length) console.error({ circuitOpen: error.reason, skipped });
          break;
        }
      }
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
