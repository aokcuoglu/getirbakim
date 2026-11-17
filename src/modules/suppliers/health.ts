import type { Pool } from "pg";

export type SupplierHealthScope = {
  supplier: string; company: string; list_group: string; warehouse: string;
  enabled: boolean; commerce_enabled: boolean;
  interval_minutes: number; stale_minutes: number; last_success_at: Date | null; next_run_at: Date;
  consecutive_failures: number; commerce_interval_minutes: number; commerce_stale_minutes: number;
  commerce_last_success_at: Date | null; commerce_next_run_at: Date; commerce_failures: number;
  catalog_stale: boolean; commerce_stale: boolean;
  /** Istanbul time of a daily (1440 min) catalog fetch, "HH:MM". */
  daily_at?: string;
};

/**
 * SUPPLIER_SCHEDULER=manual: the scheduler is off on purpose (local development, data refreshed from the admin
 * pages). Its missing heartbeat is then not a fault; stale data and failures still are. Unset in production.
 */
export const supplierSchedulerManual = () => process.env.SUPPLIER_SCHEDULER?.trim().toLowerCase() === "manual";

export function schedulerLabel(health: { manual: boolean; heartbeat: { alive: boolean } | null } | null) {
  if (!health) return "Durum okunamadı";
  return health.manual ? "Kapalı (elle)" : health.heartbeat?.alive ? "Çalışıyor" : "Sinyal yok";
}

/**
 * Scopes that fail the scheduler run (exit 1, which mails in production): failing, never succeeded, or stale.
 * A daily scope whose latest full run was a quality rejection is deferred to its next daily run (#910). It alarmed
 * on the tick that rejected it (the import error fails that run) and alarms again if the next daily run rejects or
 * the data goes stale, but not on every tick in between; supplierHealth, /api/health/suppliers and the admin pages
 * keep showing it through consecutive_failures until a run succeeds or the anomaly is accepted.
 */
export async function supplierSyncAlerts(pool: Pick<Pool, "query">) {
  return (await pool.query<{ supplier: string; company: string; list_group: string; warehouse: string; consecutive_failures: number; last_success_at: Date | null }>(
    `SELECT supplier,company,list_group,warehouse,consecutive_failures,last_success_at FROM supplier_sync_scopes s
    WHERE (enabled AND ((consecutive_failures>0 AND NOT (interval_minutes=1440 AND next_run_at>now() AND (
        SELECT r.status FROM supplier_imports r WHERE r.supplier=s.supplier AND r.company=s.company AND r.list_group=s.list_group
          AND r.warehouse=s.warehouse AND r.run_kind='full' AND r.status<>'running' ORDER BY r.started_at DESC,r.id DESC LIMIT 1
      ) IS NOT DISTINCT FROM 'rejected'))
      OR last_success_at IS NULL OR last_success_at<now()-stale_minutes*interval '1 minute'))
    OR (commerce_enabled AND (commerce_failures>0 OR commerce_last_success_at IS NULL
      OR commerce_last_success_at<now()-commerce_stale_minutes*interval '1 minute'))`)).rows;
}

// Read independently of the scheduler: a stopped process cannot report its own absence.
export async function supplierHealth(pool: Pick<Pool, "query">, company?: string, manual = supplierSchedulerManual()) {
  const heartbeat = (await pool.query<{started_at:Date;finished_at:Date|null;succeeded:boolean|null;alive:boolean}>(`
    SELECT *,CASE WHEN finished_at IS NULL THEN started_at>now()-interval '90 minutes'
      ELSE finished_at>now()-interval '35 minutes' END AS alive FROM supplier_scheduler_health WHERE id=true`)).rows[0];
  const scopes = (await pool.query<SupplierHealthScope>(`SELECT supplier,company,list_group,warehouse,enabled,commerce_enabled,
    interval_minutes,to_char(daily_at,'HH24:MI') AS daily_at,stale_minutes,last_success_at,next_run_at,consecutive_failures,
    commerce_interval_minutes,commerce_stale_minutes,commerce_last_success_at,commerce_next_run_at,commerce_failures,
    enabled AND (last_success_at IS NULL OR last_success_at<now()-stale_minutes*interval '1 minute') AS catalog_stale,
    commerce_enabled AND (commerce_last_success_at IS NULL OR commerce_last_success_at<now()-commerce_stale_minutes*interval '1 minute') AS commerce_stale
    FROM supplier_sync_scopes WHERE ($1::text IS NULL OR company=$1) AND (enabled OR commerce_enabled)
    ORDER BY supplier,list_group`, [company ?? null])).rows;
  const issues = scopes.filter(scope => scope.catalog_stale || scope.commerce_stale || scope.consecutive_failures || scope.commerce_failures);
  const healthy = manual ? issues.length===0
    : Boolean(heartbeat?.alive) && heartbeat?.succeeded !== false && scopes.length>0 && issues.length===0;
  return { checked_at: new Date(), manual, healthy, heartbeat: heartbeat ?? null, scopes, issues };
}
