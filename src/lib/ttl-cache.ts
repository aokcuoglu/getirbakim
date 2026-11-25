/**
 * Process-local cache with a hard expiry, for short-lived answers that may be repeated but must not get old (a price
 * shown for display). Unlike staleCache an entry older than `ttlMs` is never served: the caller waits for a new load.
 * Concurrent callers of one key share the load; a failed load is not cached. Least recently used entries leave first.
 */
export function ttlCache<T>(ttlMs: number, maxEntries = 100, now: () => number = Date.now) {
  const entries = new Map<string, { value: Promise<T>; expiresAt: number }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const entry = entries.get(key);
    entries.delete(key);
    if (entry && entry.expiresAt > now()) {
      entries.set(key, entry);
      return entry.value;
    }
    const time = now();
    // Expired entries are never served again: dropped on every insert, so they do not hold memory until evicted.
    for (const [stored, old] of entries) if (old.expiresAt <= time) entries.delete(stored);
    const fresh = { value: load(), expiresAt: time + ttlMs };
    fresh.value.catch(() => { if (entries.get(key) === fresh) entries.delete(key); });
    entries.set(key, fresh);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return fresh.value;
  };
}
/**
 * One load per key, shared by every caller that arrives while it runs and for `holdMs` after it settles with a value
 * (#1367). Unlike ttlCache the hold counts from the settle, not from the start: callers that wait for one value before
 * they ask for another built from the same load still share it when the load took longer than `holdMs`. A failed load is
 * dropped as it fails, so the next caller tries again. Least recently used entries leave first.
 */
export function sharedLoads<T>(holdMs: number, maxEntries = 100, now: () => number = Date.now) {
  const entries = new Map<string, { value: Promise<T>; expiresAt: number }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const time = now();
    for (const [stored, old] of entries) if (old.expiresAt <= time) entries.delete(stored);
    const entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    }
    const fresh = { value: load(), expiresAt: Infinity };
    fresh.value.then(() => { fresh.expiresAt = now() + holdMs; }, () => { if (entries.get(key) === fresh) entries.delete(key); });
    entries.set(key, fresh);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return fresh.value;
  };
}
