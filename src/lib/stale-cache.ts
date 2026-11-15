import "server-only";

type Entry<T> = { value: Promise<T>; loadedAt: number; refreshing: boolean; epoch?: number };
type Options = {
  /** Shared invalidation counter (src/modules/store/listing-epoch.ts): an entry loaded under an older value is reloaded. */
  epoch?: () => Promise<number>;
};

/**
 * Process-local cache for expensive reads that change slowly (catalog counts, facets, page ids).
 * After `ttlMs` the stale value is still served while a single refresh runs in the background, so
 * visitors never wait for the query again once a key has loaded; a failed refresh keeps the old value.
 * With `epoch`, an entry loaded before the counter moved is not served: the caller waits for a new load
 * (concurrent callers share it); if that load fails the old value is put back and returned, and the next
 * request tries again. Each app container keeps its own copy; prices and stock must not go through here.
 */
export function staleCache<T>(ttlMs: number, maxEntries = 500, options: Options = {}) {
  const entries = new Map<string, Entry<T>>();
  const insert = (key: string, load: () => Promise<T>, epoch: number | undefined, previous?: Entry<T>) => {
    const fresh: Entry<T> = { value: load(), loadedAt: Date.now(), refreshing: false, epoch };
    if (previous) {
      // A failed reload after an epoch change serves the old value; the old entry's epoch makes the next request try again.
      fresh.value = fresh.value.catch(error => {
        console.error("Stale cache reload failed; serving the previous value", error);
        if (entries.get(key) === fresh) entries.set(key, previous);
        return previous.value;
      });
    } else {
      // A failed first load is not cached: the next request tries again.
      fresh.value.catch(() => { if (entries.get(key) === fresh) entries.delete(key); });
    }
    entries.delete(key);
    entries.set(key, fresh);
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return fresh.value;
  };
  const read = (key: string, load: () => Promise<T>, epoch: number | undefined): Promise<T> => {
    const entry = entries.get(key);
    if (!entry) return insert(key, load, epoch);
    // An entry from an older epoch is stale; one from a newer epoch (a racing read saw the bump first) is kept.
    if (epoch !== undefined && (entry.epoch === undefined || entry.epoch < epoch)) return insert(key, load, epoch, entry);
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
  const { epoch } = options;
  return (key: string, load: () => Promise<T>): Promise<T> =>
    epoch ? epoch().then(current => read(key, load, current)) : read(key, load, undefined);
}
