/** Why a cart line could not be confirmed live; the order then sells it on its saved data and marks the line. */
export type FallbackReason = "timeout" | "upstream" | "busy" | "paused" | "config" | "contract";
const fallbackReasons: readonly string[] = ["timeout", "upstream", "busy", "paused", "config", "contract"] satisfies FallbackReason[];
const isFallbackReason = (value: unknown): value is FallbackReason => typeof value === "string" && fallbackReasons.includes(value);

/** Maps a supplier error (Başbuğ, SETA and Dinamik errors all carry `reason`) to a line marker; "rejected" and unknown errors are upstream. */
export function fallbackReason(error: unknown): FallbackReason {
  if (typeof error !== "object" || error === null) return "upstream";
  if ("name" in error && error.name === "TimeoutError") return "timeout";
  return "reason" in error && isFallbackReason(error.reason) ? error.reason : "upstream";
}

/**
 * How long a checkout write waits for supplier rows a running list import holds. It stays below Postgres' default
 * deadlock_timeout (1 s) so that, in a two-party wait, the checkout gives up before the deadlock check runs and the
 * import is not chosen as the victim. lock_timeout applies per lock, so waits involving three or more parties can
 * still exceed 1 s in total. NOWAIT is too strict:
 * submitOrder holds the cart's rows FOR SHARE, so a concurrent order would be turned away as busy for nothing.
 * submitOrder's own FOR SHARE uses it too (#790): past it, the order goes on with the rows as committed before the import.
 */
export const CHECKOUT_LOCK_TIMEOUT = "SET LOCAL lock_timeout = '500ms'";

/**
 * Total time a checkout's live check may spend on one supplier's per-code endpoint (Başbuğ MalzemeAra, Dinamik
 * getStock); each request also stops after at most 5 s. Lines not answered in time are sold on saved data as "timeout".
 */
export const CHECKOUT_REFRESH_BUDGET_MS = 8_000;
