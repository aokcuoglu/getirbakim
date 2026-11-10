/**
 * Fixed-window request limit per key, kept in process memory (the storefront runs as a single process).
 * Checked before authentication so that a client guessing keys is limited too.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } => {
    const time = now();
    // Expired windows are dropped as they are met; the map stays bounded by the clients of one window.
    if (windows.size > 10_000) for (const [stored, window] of windows) if (time - window.start >= windowMs) windows.delete(stored);
    const window = windows.get(key);
    if (!window || time - window.start >= windowMs) {
      windows.set(key, { start: time, count: 1 });
      return { allowed: true };
    }
    if (window.count >= limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.start + windowMs - time) / 1000)) };
    window.count += 1;
    return { allowed: true };
  };
}
