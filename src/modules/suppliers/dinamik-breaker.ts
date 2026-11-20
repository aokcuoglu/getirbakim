/**
 * Per-tick circuit breaker for the Dinamik brand loop in scripts/sync-suppliers.ts (#1071).
 *
 * One brand's list can fail on its own: HELLA's getStockList answered HTTP 500 after ~30 s on several nights while
 * hundreds of other brands succeeded in the same runs. Such failures only stop the tick once they repeat across
 * consecutive brands. Failures that say Dinamik itself refuses or is occupied stop it at once.
 */

/** Consecutive brand failures (5xx, timeout, network) after which the remaining Dinamik brands of the tick are skipped. */
export const DINAMIK_UPSTREAM_FAILURE_LIMIT = 3;

// Not brand-specific: missing settings, another import holding the lock, an operator stop.
const immediateReasons = new Set(["config", "busy", "paused"]);
// The access allow-list or the credentials were refused; every other brand would be refused too.
const refusedStatus = /\bHTTP 40[13]$/;

/** A brand's result: success, or the failing DinamikImportError's `reason` and `detail`. */
export type DinamikBrandOutcome = { ok: true } | { ok: false; reason: string; detail?: string };

/**
 * The breaker state after one brand. `failures` counts consecutive upstream failures; a success resets it, and so do
 * `rejected`/`contract`, because Dinamik answered for that brand. Unknown failures leave the count unchanged.
 */
export function nextDinamikBreaker(failures: number, outcome: DinamikBrandOutcome): { failures: number; open: boolean } {
  if (outcome.ok || outcome.reason === "rejected" || outcome.reason === "contract") return { failures: 0, open: false };
  if (immediateReasons.has(outcome.reason)) return { failures, open: true };
  if (outcome.reason !== "upstream") return { failures, open: false };
  if (outcome.detail && refusedStatus.test(outcome.detail)) return { failures: failures + 1, open: true };
  const next = failures + 1;
  return { failures: next, open: next >= DINAMIK_UPSTREAM_FAILURE_LIMIT };
}
