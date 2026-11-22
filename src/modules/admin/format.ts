// Shared admin formatters for every /yonetim page. Every date is shown in Istanbul time, in the overview's short style
// ("14 Kas 03:05"); formatDate adds the year only for dates outside the current year, formatDateTime on request.

const zone = "Europe/Istanbul";
const integer = new Intl.NumberFormat("tr-TR");
const decimal = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 });
const yearOf = (value: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: zone, year: "numeric" }).format(value);

/** A calendar day `YYYY-MM-DD` (already an Istanbul day) as `DD.MM.YYYY`. */
export const formatDay = (value: string) => value.split("-").reverse().join(".");

/** Count or amount, Turkish grouping, at most two decimals; a missing value reads 0. */
export function formatNumber(value: number | null | undefined) {
  const number = value ?? 0;
  return Number.isInteger(number) ? integer.format(number) : decimal.format(number);
}

/** Supplier source values as sent: up to six decimals ("0,123456"), Turkish grouping. */
export const formatExact = (value: number) => exact.format(value);

/** Fixed decimals for prices and rates: "1.234,50" with the default two digits. */
export const formatDecimal = (value: number, digits = 2) =>
  value.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "14 Kas 03:05" (Istanbul time); "14 Kas 2025 03:05" for another year; `fallback` for a missing date. */
export function formatDate(value: Date | null | undefined, { fallback = "—", now = new Date() }: { fallback?: string; now?: Date } = {}) {
  if (!value) return fallback;
  return value.toLocaleString("tr-TR", {
    timeZone: zone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    ...(yearOf(value) !== yearOf(now) ? { year: "numeric" } : {}),
  });
}

/**
 * "14 Kas 03:05" (Istanbul time) whatever the year; `year` gives "14 Kas 2026 03:05" (order lists), `seconds` adds the
 * seconds (live worker progress).
 */
export function formatDateTime(value: Date | string, { year = false, seconds = false }: { year?: boolean; seconds?: boolean } = {}) {
  return new Date(value).toLocaleString("tr-TR", {
    timeZone: zone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    ...(year ? { year: "numeric" } : {}), ...(seconds ? { second: "2-digit" } : {}),
  });
}

/**
 * Time since a date: "az önce", "5 dk önce", "3 sa önce", "2 gün önce"; `fallback` for a missing date. `justNow`
 * lets a sentence-initial cell read "Az önce".
 */
export function formatAgo(value: Date | string | null | undefined, { now = new Date(), fallback = "Henüz yok", justNow = "az önce" }: {
  now?: Date; fallback?: string; justNow?: string;
} = {}) {
  if (!value) return fallback;
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return justNow;
  if (minutes < 60) return `${minutes} dk önce`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} sa önce`;
  return `${Math.round(minutes / 1440)} gün önce`;
}

/** Supplier record timestamps to the second, numeric: "14.11.2026 03:05:09" (Istanbul time). */
export const formatTimestamp = (value: Date) => value.toLocaleString("tr-TR", {
  timeZone: zone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

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
