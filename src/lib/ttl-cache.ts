/**
 * Process-local cache with a hard expiry, for short-lived answers that may be repeated but must not get old (a price
 * shown for display). Unlike staleCache an entry older than `ttlMs` is never served: the caller waits for a new load.
 * Concurrent callers of one key share the load; a failed load is not cached. Least recently used entries leave first.
 */
export function ttlCache<T>(ttlMs: number, maxEntries = 500, now: () => number = Date.now) {
  const entries = new Map<string, { value: Promise<T>; expiresAt: number }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const entry = entries.get(key);
    entries.delete(key);
    if (entry && entry.expiresAt > now()) {
      entries.set(key, entry);
      return entry.value;
    }
    const fresh = { value: load(), expiresAt: now() + ttlMs };
    fresh.value.catch(() => { if (entries.get(key) === fresh) entries.delete(key); });
    entries.set(key, fresh);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return fresh.value;
  };
}
