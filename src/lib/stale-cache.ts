import "server-only";

type Entry<T> = { value: Promise<T>; loadedAt: number; refreshing: boolean; epoch?: number; weight: number };
type Instance = { size: () => number; weight: () => number };
// Next bundles instrumentation.ts (which logs the stats) apart from the route handlers (which create the caches), so a
// module-level set would be empty where it is read. Weak references: a dev re-evaluation of a module must not pin the
// caches of its previous copy.
const globalInstances = globalThis as typeof globalThis & { __staleCacheInstances?: Set<WeakRef<Instance>> };
const instances = (globalInstances.__staleCacheInstances ??= new Set<WeakRef<Instance>>());
/** Entries and summed weight over every stale cache of this process, for the memory log line (#1262). */
export function staleCacheStats() {
  let entries = 0, weight = 0;
  for (const ref of instances) {
    const instance = ref.deref();
    if (!instance) { instances.delete(ref); continue; }
    entries += instance.size();
    weight += instance.weight();
  }
  return { entries, weight };
}
/** A value read from a store, or loaded now (`ageMs` undefined: its age is counted from the load). */
type Loaded<T> = { value: T; ageMs?: number };
/** A second cache level shared by every process (src/modules/store/listing-cache-store.ts). Values must survive JSON. */
export type StaleCacheStore<T> = {
  /** The stored value, its age by the store's clock and the epoch it was loaded under; null when there is none. */
  read(key: string): Promise<{ value: T; ageMs: number; epoch: number } | null>;
  write(key: string, value: T, epoch: number): Promise<void>;
};
type Options<T> = {
  /** Shared invalidation counter (src/modules/store/listing-epoch.ts): an entry loaded under an older value is reloaded. */
  epoch?: () => Promise<number>;
  /** Optional second level read on a memory miss and written after every load. Its errors count as a miss. */
  store?: StaleCacheStore<T>;
  /** The oldest stored value a memory miss may adopt (default: ttlMs); older ones are loaded again. */
  maxStaleMs?: number;
  /** Size of a loaded value (e.g. its id count). With `maxWeight`, the oldest entries go once the total exceeds it (#1262). */
  weigh?: (value: T) => number;
  /**
   * Total weight kept. The entry just loaded always stays, so a single value heavier than this evicts every other
   * entry and is itself evicted by the next load of another key. Entries still loading are never evicted.
   */
  maxWeight?: number;
};

/**
 * Process-local cache for expensive reads that change slowly (catalog counts, facets, page ids).
 * After `ttlMs` the stale value is still served while a single refresh runs in the background, so
 * visitors never wait for the query again once a key has loaded; a failed refresh keeps the old value.
 * With `epoch`, an entry loaded before the counter moved is not served: the caller waits for a new load
 * (concurrent callers share it); if that load fails the old value is put back and returned, and the next
 * request tries again. Each app container keeps its own copy; prices and stock must not go through here.
 *
 * With `store`, a memory miss first reads the shared level: a stored value of the current epoch (or newer) no older than
 * `maxStaleMs` is adopted with its age, so one older than `ttlMs` is served while a background refresh runs. A refresh
 * or epoch reload also reads the store first and adopts a value younger than `ttlMs` that another process already
 * computed; only otherwise does it load and write the result back (not awaited). Pass `{ persist: false }` for keys
 * that must stay in memory only (too many variants to be worth sharing).
 */
export function staleCache<T>(ttlMs: number, maxEntries = 500, options: Options<T> = {}) {
  const { epoch, store, maxStaleMs = ttlMs, weigh, maxWeight } = options;
  const entries = new Map<string, Entry<T>>();
  let totalWeight = 0;
  const instance: Instance = { size: () => entries.size, weight: () => totalWeight };
  instances.add(new WeakRef(instance));
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    totalWeight -= entry.weight;
    entries.delete(key);
  };
  const measure = (value: T) => weigh ? weigh(value) : 0;
  // Called after a load: the oldest entries go while the total is over the bound; `keep` (the loaded one) stays.
  const trim = (keep: string) => {
    if (maxWeight === undefined) return;
    for (const key of entries.keys()) {
      if (totalWeight <= maxWeight || entries.size <= 1) return;
      // A pending entry (weight 0) frees nothing, and dropping it would make its next reader load the value again.
      if (key !== keep && entries.get(key)!.weight > 0) drop(key);
    }
  };
  // Reads the store first when `persist`; a stored value is adopted when its epoch is current and it is at most `maxAgeMs` old.
  const obtain = async (key: string, load: () => Promise<T>, at: number, persist: boolean, maxAgeMs: number): Promise<Loaded<T>> => {
    if (persist && store) {
      const row = await Promise.resolve().then(() => store.read(key)).catch(() => null);
      if (row && row.epoch >= at && row.ageMs <= maxAgeMs) return { value: row.value, ageMs: Math.max(0, row.ageMs) };
    }
    const value = await load();
    if (persist && store) Promise.resolve().then(() => store.write(key, value, at)).catch(() => {});
    return { value };
  };
  const refresh = (key: string, entry: Entry<T>, load: () => Promise<T>, at: number, persist: boolean) => {
    entry.refreshing = true;
    obtain(key, load, at, persist, ttlMs)
      .then(loaded => {
        entry.value = Promise.resolve(loaded.value);
        entry.loadedAt = Date.now() - (loaded.ageMs ?? 0);
        // An entry evicted while it refreshed is no longer counted.
        if (entries.get(key) === entry) {
          const weight = measure(loaded.value);
          totalWeight += weight - entry.weight;
          entry.weight = weight;
          trim(key);
        }
      })
      .catch(error => console.error("Stale cache refresh failed; serving the previous value", error))
      .finally(() => { entry.refreshing = false; });
  };
  const insert = (key: string, load: () => Promise<T>, epoch: number | undefined, persist: boolean, previous?: Entry<T>) => {
    const loadedAt = Date.now();
    // A memory miss may adopt a value up to maxStaleMs old; an epoch reload only one another process just computed.
    const value = obtain(key, load, epoch ?? 0, persist, previous ? ttlMs : maxStaleMs).then(loaded => {
      if (loaded.ageMs !== undefined) {
        fresh.loadedAt = Date.now() - loaded.ageMs;
        // An adopted value past the TTL is served now and refreshed once in the background.
        if (loaded.ageMs > ttlMs && entries.get(key) === fresh) refresh(key, fresh, load, epoch ?? 0, persist);
      }
      if (entries.get(key) === fresh) {
        // A refresh of this pending entry may have set a weight already: count only the difference.
        const weight = measure(loaded.value);
        totalWeight += weight - fresh.weight;
        fresh.weight = weight;
        trim(key);
      }
      return loaded.value;
    });
    const fresh: Entry<T> = { value, loadedAt, refreshing: false, epoch, weight: 0 };
    if (previous) {
      // A failed reload after an epoch change serves the old value; the old entry's epoch makes the next request try again.
      fresh.value = fresh.value.catch(error => {
        console.error("Stale cache reload failed; serving the previous value", error);
        if (entries.get(key) === fresh) { drop(key); entries.set(key, previous); totalWeight += previous.weight; trim(key); }
        return previous.value;
      });
    } else {
      // A failed first load is not cached: the next request tries again.
      fresh.value.catch(() => { if (entries.get(key) === fresh) drop(key); });
    }
    drop(key);
    entries.set(key, fresh);
    if (entries.size > maxEntries) drop(entries.keys().next().value!);
    return fresh.value;
  };
  const read = (key: string, load: () => Promise<T>, epoch: number | undefined, persist: boolean): Promise<T> => {
    const entry = entries.get(key);
    if (!entry) return insert(key, load, epoch, persist);
    // An entry from an older epoch is stale; one from a newer epoch (a racing read saw the bump first) is kept.
    if (epoch !== undefined && (entry.epoch === undefined || entry.epoch < epoch)) return insert(key, load, epoch, persist, entry);
    // Map order doubles as recency for eviction.
    entries.delete(key); entries.set(key, entry);
    if (!entry.refreshing && Date.now() - entry.loadedAt > ttlMs) refresh(key, entry, load, epoch ?? 0, persist);
    return entry.value;
  };
  return (key: string, load: () => Promise<T>, { persist = true }: { persist?: boolean } = {}): Promise<T> => {
    void instance; // keeps the instance (and its weak registration) alive as long as the cache is used
    const shared = persist && Boolean(store);
    return epoch ? epoch().then(current => read(key, load, current, shared)) : read(key, load, undefined, shared);
  };
}
