export type PassPace = {
  finished_24h: number; active_windows_24h: number; linked_products: number; fallback_pending_found_24h: number;
  interval_ms: number | null; challenge_since: Date | null; blocked: boolean | null;
};
/** Trodo's products per active hour, and the calendar days the pending queue needs at the last 24 hours' pace. Products
 *  spareto found in the pending queue left it too; the ones it could not find stay pending for Trodo, so only finds count. */
export function passForecast(pace: PassPace, pending: number) {
  const activeHours = pace.active_windows_24h / 6, cleared = pace.finished_24h + pace.fallback_pending_found_24h;
  return {
    activeHours, uptime: Math.min(1, activeHours / 24),
    perActiveHour: activeHours ? pace.finished_24h / activeHours : 0,
    daysLeft: cleared ? pending / cleared : null,
    daysLeftAlwaysOn: activeHours && pace.finished_24h ? pending / (pace.finished_24h / activeHours * 24 + pace.fallback_pending_found_24h) : null,
  };
}

export type SourceKey = "trodo" | "otoparcasan" | "spareto" | "parts2world";
export type SourceActivity = { source: SourceKey; searched: number; found: number; errors: number; last_hour: number; last: Date | null; last_outcome: string | null };
export type SourceSummary = SourceActivity & { written: number; hitRate: number | null; state: "running" | "idle" | "blocked" };
export const sourceHosts: Record<SourceKey, string> = { trodo: "www.trodo.com", otoparcasan: "otoparcasan.com", spareto: "spareto.com", parts2world: "www.parts2world.com" };
/** One row per source in a fixed order. A source runs when it finished a search in the last 15 minutes; Trodo is
 *  blocked when its host circuit is open, a fallback source when its last run stopped on a block answer. */
export function summarizeSources(activity: SourceActivity[], written: Record<string, number>, trodoBlocked: boolean, now = Date.now()): SourceSummary[] {
  return (Object.keys(sourceHosts) as SourceKey[]).map(source => {
    const row = activity.find(a => a.source === source) ?? { source, searched: 0, found: 0, errors: 0, last_hour: 0, last: null, last_outcome: null };
    const blocked = source === "trodo" ? trodoBlocked : row.last_outcome === "blocked";
    const state = blocked ? "blocked" : row.last && now - row.last.getTime() < 15 * 60_000 ? "running" : "idle";
    return { ...row, written: written[sourceHosts[source]] ?? 0, hitRate: row.searched ? row.found / row.searched : null, state };
  });
}

export type SourceRun = { queue: string; total: number; processed: number; errors: number; started_at: Date; finished_at: Date | null;
  outcome: "complete" | "blocked" | "stopped" | "failed" | null; last: Date | null };
/** Progress of a source's latest queue run (#403): a run is going while open and its last search is under 15 minutes
 *  old; the remaining products take hoursLeft at the last hour's pace. */
export function runProgress(run: SourceRun, perHour: number, now = Date.now()) {
  const processed = Math.min(run.processed, run.total), remaining = run.total - processed;
  const state = run.finished_at ? run.outcome ?? "stopped" : run.last && now - run.last.getTime() < 15 * 60_000 ? "running" : "quiet";
  return { processed, remaining, percent: run.total ? processed / run.total * 100 : 100, state,
    hoursLeft: state === "running" && perHour ? remaining / perHour : null };
}

export { partialGaps, completeWithImage, type PartialGap } from "../enrichment/partial-gaps";
