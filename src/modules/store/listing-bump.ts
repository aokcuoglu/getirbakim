// The background link sync's listing-epoch bump (#956): listings cache their make and model fits per process, and an
// admin's edit bumps the epoch before the sync rebuilt the fit tables. A sync that changed fit rows bumps again, at most
// once per `minIntervalMs` so imports that queue many rows do not empty the caches every few seconds; a change seen
// within that time waits for a later tick.

export const fitsBumpIntervalMs = 30_000;

/** Whether a pending fit change should bump the listing epoch now (`lastBumpAt`: 0 before the first bump). */
export function fitsBumpDue(pending: boolean, lastBumpAt: number, now: number, minIntervalMs = fitsBumpIntervalMs): boolean {
  return pending && now - lastBumpAt >= minIntervalMs;
}
