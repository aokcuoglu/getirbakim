export type PassPace = {
  finished_24h: number; active_windows_24h: number; linked_products: number;
  interval_ms: number | null; challenge_since: Date | null; blocked: boolean | null;
};
/** Products per active hour, and the calendar days the pending queue needs at the last 24 hours' pace. */
export function passForecast(pace: PassPace, pending: number) {
  const activeHours = pace.active_windows_24h / 6;
  return {
    activeHours, uptime: Math.min(1, activeHours / 24),
    perActiveHour: activeHours ? pace.finished_24h / activeHours : 0,
    daysLeft: pace.finished_24h ? pending / pace.finished_24h : null,
    daysLeftAlwaysOn: activeHours && pace.finished_24h ? pending / (pace.finished_24h / activeHours * 24) : null,
  };
}
