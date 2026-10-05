import type { Pool } from "pg";

// Read independently of the scheduler: a stopped process cannot report its own absence.
export async function supplierHealth(pool: Pick<Pool, "query">, company?: string) {
  const heartbeat = (await pool.query<{started_at:Date;finished_at:Date|null;succeeded:boolean|null;alive:boolean}>(`
    SELECT *,CASE WHEN finished_at IS NULL THEN started_at>now()-interval '90 minutes'
      ELSE finished_at>now()-interval '35 minutes' END AS alive FROM supplier_scheduler_health WHERE id=true`)).rows[0];
  const scopes = (await pool.query(`SELECT supplier,company,list_group,warehouse,enabled,commerce_enabled,
    interval_minutes,stale_minutes,last_success_at,next_run_at,consecutive_failures,
    commerce_interval_minutes,commerce_stale_minutes,commerce_last_success_at,commerce_next_run_at,commerce_failures,
    enabled AND (last_success_at IS NULL OR last_success_at<now()-stale_minutes*interval '1 minute') AS catalog_stale,
    commerce_enabled AND (commerce_last_success_at IS NULL OR commerce_last_success_at<now()-commerce_stale_minutes*interval '1 minute') AS commerce_stale
    FROM supplier_sync_scopes WHERE ($1::text IS NULL OR company=$1) AND (enabled OR commerce_enabled)
    ORDER BY supplier,list_group`, [company ?? null])).rows;
  const issues = scopes.filter(scope => scope.catalog_stale || scope.commerce_stale || scope.consecutive_failures || scope.commerce_failures);
  return { healthy: Boolean(heartbeat?.alive) && heartbeat?.succeeded !== false && scopes.length>0 && issues.length===0,
    heartbeat: heartbeat ?? null, scopes, issues };
}
