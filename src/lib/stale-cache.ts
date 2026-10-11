import "server-only";

type Entry<T> = { value: Promise<T>; loadedAt: number; refreshing: boolean };

/**
 * Process-local cache for expensive reads that change slowly (catalog counts, facets, page ids).
 * After `ttlMs` the stale value is still served while a single refresh runs in the background, so
 * visitors never wait for the query again once a key has loaded; a failed refresh keeps the old value.
 * Each app container keeps its own copy; prices and stock must not go through here.
 */
export function staleCache<T>(ttlMs: number, maxEntries = 500) {
  const entries = new Map<string, Entry<T>>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const entry = entries.get(key);
    if (!entry) {
      const value = load();
      const fresh: Entry<T> = { value, loadedAt: Date.now(), refreshing: false };
      entries.set(key, fresh);
      // A failed first load is not cached: the next request tries again.
      value.catch(() => { if (entries.get(key) === fresh) entries.delete(key); });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
      return value;
    }
    // Map order doubles as recency for eviction.
    entries.delete(key); entries.set(key, entry);
    if (!entry.refreshing && Date.now() - entry.loadedAt > ttlMs) {
      entry.refreshing = true;
      load().then(value => { entry.value = Promise.resolve(value); entry.loadedAt = Date.now(); })
        .catch(error => console.error("Stale cache refresh failed; serving the previous value", error))
        .finally(() => { entry.refreshing = false; });
    }
    return entry.value;
  };
}
