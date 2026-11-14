// Shared admin formatters (supplier pages, supplier overview). Every date is shown in Istanbul time, in the overview's
// short style ("14 Kas 03:05"); the year is added only for dates outside the current year.

const zone = "Europe/Istanbul";
const integer = new Intl.NumberFormat("tr-TR");
const decimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const yearOf = (value: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: zone, year: "numeric" }).format(value);

/** Count or amount, Turkish grouping, at most two decimals; a missing value reads 0. */
export function formatNumber(value: number | null | undefined) {
  const number = value ?? 0;
  return Number.isInteger(number) ? integer.format(number) : decimal.format(number);
}

/** "14 Kas 03:05" (Istanbul time); "14 Kas 2025 03:05" for another year; `fallback` for a missing date. */
export function formatDate(value: Date | null | undefined, { fallback = "—", now = new Date() }: { fallback?: string; now?: Date } = {}) {
  if (!value) return fallback;
  return value.toLocaleString("tr-TR", {
    timeZone: zone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    ...(yearOf(value) !== yearOf(now) ? { year: "numeric" } : {}),
  });
}

/** Whole seconds between two instants; null while the second one is missing. */
export function durationSeconds(start: Date, end: Date | null | undefined) {
  return end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)) : null;
}

/** Run duration: "45 sn", "3 dk 5 sn", "1 sa 2 dk"; "Devam ediyor" while the run has not finished. */
export function formatDuration(start: Date, end: Date | null | undefined) {
  const seconds = durationSeconds(start, end);
  if (seconds === null) return "Devam ediyor";
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes} dk ${seconds % 60} sn` : `${minutes} dk`;
  return minutes % 60 ? `${Math.floor(minutes / 60)} sa ${minutes % 60} dk` : `${Math.floor(minutes / 60)} sa`;
}

/** "04:00:00" (Postgres time) → "04:00". */
export const formatClock = (value: string | null | undefined) => value ? value.slice(0, 5) : null;

/**
 * How often a scheduled fetch runs, one wording for every page: "30 dakikada bir", "2 saatte bir", "her gün 04:00",
 * "3 günde bir". A daily fetch names its Istanbul time when known.
 */
export function formatInterval(minutes: number | null | undefined, dailyAt?: string | null) {
  if (!minutes) return "—";
  if (minutes === 1440) return dailyAt ? `her gün ${formatClock(dailyAt)}` : "her gün";
  if (minutes % 1440 === 0) return `${minutes / 1440} günde bir`;
  if (minutes % 60 === 0) return `${minutes / 60} saatte bir`;
  return `${minutes} dakikada bir`;
}
