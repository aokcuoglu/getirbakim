import { supplierRunError } from "./run-error";
import type { StatusTone } from "./run-status";

// Supplier data status for the admin: is the data on the shelf fresh, and which problems are open right now?
// Deliberately independent of the scheduler: a manual refresh makes data just as current as a scheduled pass, and a
// stopped scheduler is an operational notice, not a data problem. /api/health/suppliers keeps the monitoring view
// (heartbeat included) in health.ts.

export type FeedScope = {
  list_group: string;
  enabled: boolean;
  interval_minutes: number;
  stale_minutes: number;
  last_success_at: Date | null;
  consecutive_failures: number;
  /** Products of this scope are currently present in supplier_items (on sale or sellable). */
  has_items: boolean;
  /** Reason of the latest import of this scope, read only when it is currently failing. */
  error_reason?: string | null;
};

export type FeedState = "fresh" | "partial" | "stale" | "never" | "unconfigured";

export type FeedStatus = {
  state: FeedState;
  /** Scopes whose data is shown in the store or that the scheduler is expected to fetch. */
  tracked: number;
  fresh: number;
  stale: FeedScope[];
  never: FeedScope[];
  failing: FeedScope[];
  lastSuccess: Date | null;
  oldestSuccess: Date | null;
  /** Tracked scopes the scheduler fetches on its own; 0 means data only changes on a manual refresh. */
  automated: number;
  intervalMinutes: number | null;
  staleMinutes: number | null;
};

// A disabled scope without products (a brand taken out of the feed) is history, not a gap; a disabled scope whose
// products are still shown must stay fresh, because the store sells from it.
const isTracked = (scope: FeedScope) => scope.enabled || scope.has_items;

/** Most frequent value; on a tie the one that appears first wins. Null for an empty list. */
export function mode(values: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | null = null, bestCount = 0;
  // Map keeps first-appearance order, so the strict comparison keeps the earliest of equally frequent values.
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return best;
}

export function evaluateFeed(scopes: FeedScope[], now: Date, configured = true): FeedStatus {
  const tracked = scopes.filter(isTracked);
  const freshScope = (scope: FeedScope) => Boolean(scope.last_success_at) && scope.last_success_at!.getTime() >= now.getTime() - scope.stale_minutes * 60_000;
  const fresh = tracked.filter(freshScope);
  const never = tracked.filter(scope => !scope.last_success_at);
  const stale = tracked.filter(scope => scope.last_success_at && !freshScope(scope));
  const successes = tracked.map(scope => scope.last_success_at).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime());
  const automated = tracked.filter(scope => scope.enabled);
  const state: FeedState = !configured ? "unconfigured"
    : !successes.length ? "never"
    : fresh.length === tracked.length ? "fresh"
    : fresh.length === 0 ? "stale" : "partial";
  return {
    state, tracked: tracked.length, fresh: fresh.length, stale, never,
    failing: tracked.filter(scope => scope.consecutive_failures > 0),
    lastSuccess: successes.at(-1) ?? null, oldestSuccess: successes[0] ?? null,
    automated: automated.length,
    intervalMinutes: mode(automated.map(scope => scope.interval_minutes)),
    staleMinutes: mode(tracked.map(scope => scope.stale_minutes)),
  };
}

/** Open problems of a feed, worst first. Failed attempts that a later run fixed are not problems. */
export function feedIssueCount(status: FeedStatus) {
  const failingOnly = status.failing.filter(scope => !status.stale.includes(scope) && !status.never.includes(scope));
  return status.stale.length + status.never.length + failingOnly.length;
}

export const feedStateLabels: Record<FeedState, string> = {
  fresh: "Güncel",
  partial: "Kısmen güncel",
  stale: "Güncel değil",
  never: "Henüz çekilmedi",
  unconfigured: "Bağlantı eksik",
};

export const feedStateTones: Record<FeedState, StatusTone> = {
  fresh: "success",
  partial: "warning",
  stale: "error",
  never: "neutral",
  unconfigured: "warning",
};

/** Sidebar dot: green only when the data is fresh and nothing is open. */
export function feedNavTone(status: FeedStatus): "success" | "warning" | "danger" | "neutral" {
  if (status.state === "never" || status.state === "unconfigured") return "neutral";
  if (status.state === "stale") return "danger";
  return status.state === "fresh" && feedIssueCount(status) === 0 ? "success" : "warning";
}

/** Plain-language reason of a failed or rejected import (supplier_imports.error_reason); the wording lives in run-error.ts. */
export function importErrorLabel(reason: string | null | undefined, source?: FeedSupplier) {
  return reason ? supplierRunError(reason, source) : "Neden kaydedilmemiş";
}

export type FeedSupplier = "basbug" | "dinamik" | "seta";
type Queryable = { query: <R extends object = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }> };

/** Every sync scope of the API suppliers with the facts evaluateFeed needs (~800 rows, index lookups only). */
export async function supplierFeedScopes(pool: Queryable, companies: Record<FeedSupplier, string>) {
  const rows = (await pool.query<FeedScope & { supplier: FeedSupplier }>(`SELECT s.supplier,s.list_group,s.enabled,s.interval_minutes,s.stale_minutes,
      s.last_success_at,s.consecutive_failures,
      EXISTS (SELECT 1 FROM supplier_items i WHERE i.supplier=s.supplier AND i.company=s.company AND i.list_group=s.list_group
        AND i.warehouse=s.warehouse AND i.presence='present') AS has_items,
      CASE WHEN s.consecutive_failures>0 THEN (SELECT r.error_reason FROM supplier_imports r WHERE r.supplier=s.supplier AND r.company=s.company
        AND r.list_group=s.list_group AND r.warehouse=s.warehouse ORDER BY r.started_at DESC LIMIT 1) END AS error_reason
    FROM supplier_sync_scopes s
    WHERE (s.supplier,s.company) IN (('basbug',$1),('dinamik',$2),('seta',$3))
    ORDER BY s.supplier,s.list_group`, [companies.basbug, companies.dinamik, companies.seta])).rows;
  const of = (supplier: FeedSupplier) => rows.filter(row => row.supplier === supplier);
  return { basbug: of("basbug"), dinamik: of("dinamik"), seta: of("seta") };
}

/** The scheduler process's last pass; `alive` mirrors supplierHealth so both pages agree. */
export async function supplierSchedulerState(pool: Queryable) {
  return (await pool.query<{ started_at: Date; finished_at: Date | null; succeeded: boolean | null; alive: boolean }>(`SELECT started_at,finished_at,succeeded,
    CASE WHEN finished_at IS NULL THEN started_at>now()-interval '90 minutes' ELSE finished_at>now()-interval '35 minutes' END AS alive
    FROM supplier_scheduler_health WHERE id=true`)).rows[0] ?? null;
}
