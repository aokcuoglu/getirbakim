/**
 * Fixed-window request limit per key, kept in process memory (each app task counts on its own). Calling the limiter
 * counts a request; `peek` answers whether one more would be allowed without counting it (#1093: the partner guard
 * counts only failed key checks per address, and refuses an address over its budget before checking a key).
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  type Result = { allowed: true } | { allowed: false; retryAfterSeconds: number };
  const check = (key: string, count: boolean): Result => {
    const time = now();
    // Expired windows are dropped as they are met; the map stays bounded by the clients of one window.
    if (windows.size > 10_000) for (const [stored, window] of windows) if (time - window.start >= windowMs) windows.delete(stored);
    const window = windows.get(key);
    if (!window || time - window.start >= windowMs) {
      if (count) windows.set(key, { start: time, count: 1 });
      return { allowed: true };
    }
    if (window.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - time) / 1000)) };
    if (count) window.count += 1;
    return { allowed: true };
  };
  return Object.assign((key: string) => check(key, true), { peek: (key: string) => check(key, false) });
}
