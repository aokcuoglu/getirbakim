/**
 * Shared pagination/filter helpers used across lib/actions/admin-*.ts and
 * lib/actions/customer-requests.ts.
 *
 * These previously duplicated verbatim in 4+ files (admin-orders, admin-customers,
 * admin-products, customer-requests, admin-suppliers). Keep the signatures stable
 * so call sites can switch to the shared helpers with minimal churn.
 */

export const DEFAULT_LIMIT = 20

/**
 * Coerce an unknown value to a finite number with a fallback.
 * Used for sanitizing loose search-param / form input before DB queries.
 */
export function toNumber(value: unknown, fallback = 0): number {
  if (value == null) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Clamp a value into the [min, max] range. Used for limit clamping.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}