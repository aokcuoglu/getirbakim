// The background link sync's fits-epoch bump (#956, #1368): listings cache their make and model fits per process, and an
// admin's edit bumps the epoch before the sync rebuilt the fit tables. A sync that changed fit rows bumps the fits epoch
// (invalidateFits, listing-epoch.ts: only the caches that read vehicle fits reload), at most once per `minIntervalMs` so
// imports that queue many rows do not empty those caches every few seconds; a change seen within that time waits for a
// later tick.

export const fitsBumpIntervalMs = 30_000;

/** Whether a pending fit change should bump the fits epoch now (`lastBumpAt`: 0 before the first bump). */
export function fitsBumpDue(pending: boolean, lastBumpAt: number, now: number, minIntervalMs = fitsBumpIntervalMs): boolean {
  return pending && now - lastBumpAt >= minIntervalMs;
}
