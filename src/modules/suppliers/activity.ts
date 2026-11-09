import type { Pool } from "pg";

export type SupplierName = "basbug" | "seta" | "dinamik";
export type SupplierActivity = {
  supplier: SupplierName; running: boolean; group: string | null; started_at: string | null;
  /** Scopes of this supplier finished since the running scheduler pass began (null outside a scheduler pass). */
  completed: number | null;
};

// What is being fetched right now, read from the import records every importer writes before calling the API.
// A "running" row older than the worker limit (90 min) belongs to a dead worker and is not shown as live.
// Inside a scheduler pass, an import that ended under a minute ago still counts: the next scope starts
// milliseconds later, and a poll landing in between should not report the fetch as finished.
export async function supplierActivity(pool: Pick<Pool, "query">, supplier: SupplierName): Promise<SupplierActivity> {
  const row = (await pool.query<{ list_group: string | null; started_at: Date | null; completed: number | null }>(`
    WITH pass AS (SELECT started_at FROM supplier_scheduler_health WHERE id AND finished_at IS NULL AND started_at>now()-interval '90 minutes'),
    run AS (SELECT list_group,started_at FROM supplier_imports WHERE supplier=$1 AND started_at>now()-interval '90 minutes'
      AND (status='running' OR (EXISTS(SELECT 1 FROM pass) AND completed_at>now()-interval '1 minute'))
      ORDER BY status='running' DESC,started_at DESC LIMIT 1)
    SELECT run.list_group,run.started_at,
      CASE WHEN pass.started_at IS NOT NULL THEN (SELECT count(*)::int FROM supplier_imports i WHERE i.supplier=$1
        AND i.status<>'running' AND i.completed_at>=pass.started_at) END AS completed
    FROM (SELECT 1) one LEFT JOIN run ON true LEFT JOIN pass ON true`, [supplier])).rows[0];
  return { supplier, running: Boolean(row?.started_at), group: row?.list_group ?? null, started_at: row?.started_at?.toISOString() ?? null,
    completed: row?.started_at ? row.completed : null };
}
