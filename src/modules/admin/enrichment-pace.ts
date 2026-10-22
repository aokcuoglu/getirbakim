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

export type SourceKey = "trodo" | "otoparcasan" | "spareto";
export type SourceActivity = { source: SourceKey; searched: number; found: number; errors: number; last: Date | null; last_outcome: string | null };
export type SourceSummary = SourceActivity & { written: number; hitRate: number | null; state: "running" | "idle" | "blocked" };
export const sourceHosts: Record<SourceKey, string> = { trodo: "www.trodo.com", otoparcasan: "otoparcasan.com", spareto: "spareto.com" };
/** One row per source in a fixed order. A source runs when it finished a search in the last 15 minutes; Trodo is
 *  blocked when its host circuit is open, a fallback source when its last run stopped on a block answer. */
export function summarizeSources(activity: SourceActivity[], written: Record<string, number>, trodoBlocked: boolean, now = Date.now()): SourceSummary[] {
  return (Object.keys(sourceHosts) as SourceKey[]).map(source => {
    const row = activity.find(a => a.source === source) ?? { source, searched: 0, found: 0, errors: 0, last: null, last_outcome: null };
    const blocked = source === "trodo" ? trodoBlocked : row.last_outcome === "blocked";
    const state = blocked ? "blocked" : row.last && now - row.last.getTime() < 15 * 60_000 ? "running" : "idle";
    return { ...row, written: written[sourceHosts[source]] ?? 0, hitRate: row.searched ? row.found / row.searched : null, state };
  });
}

export { partialGaps, completeWithImage, type PartialGap } from "../enrichment/partial-gaps";
