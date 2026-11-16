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
 * How long a checkout write waits for supplier rows a running list import holds. It must stay below Postgres' default
 * deadlock_timeout (1 s) so the checkout gives up before the import becomes the deadlock victim. NOWAIT is too strict:
 * submitOrder holds the cart's rows FOR SHARE, so a concurrent order would be turned away as busy for nothing.
 */
export const CHECKOUT_LOCK_TIMEOUT = "SET LOCAL lock_timeout = '500ms'";
