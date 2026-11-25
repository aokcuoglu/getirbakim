import "server-only";

/** An earlier value callers of a pending load may get after maxWaitMs; null when there is none they may get. */
type Earlier<T> = { value: T } | null;
/**
 * `known`: the value the entry last resolved to (unset while its first load is pending). `earlier` and `fallbackAt` (when
 * it may be served) are set only while a load with a finite maxWaitMs is pending.
 */
type Entry<T> = {
  value: Promise<T>; loadedAt: number; refreshing: boolean; epoch?: number; weight: number; known?: { value: T };
  earlier?: () => Promise<Earlier<T>>; fallbackAt?: number;
};
type Instance = { size: () => number; weight: () => number };
// Next bundles instrumentation.ts (which logs the stats) apart from the route handlers (which create the caches), so a
// module-level set would be empty where it is read. Instances are registered only in production, where every
// staleCache() call is module-level (a bounded number), so a dev re-evaluation pins nothing. Not WeakRefs: the SWC
// minifier inlines the instance object into the WeakRef and the registry empties after one GC.
const globalInstances = globalThis as typeof globalThis & { __staleCacheInstances?: Set<Instance> };
const instances = (globalInstances.__staleCacheInstances ??= new Set<Instance>());
/** Entries and summed weight over every stale cache of this process, for the memory log line (#1262). */
export function staleCacheStats() {
  let entries = 0, weight = 0;
  for (const instance of instances) { entries += instance.size(); weight += instance.weight(); }
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
  /**
   * How long after a load starts its callers may wait for it when an earlier value exists (#771): the entry an epoch
   * reload replaces, or a stored value a memory miss may not adopt (an older epoch, or older than maxStaleMs). Past it
   * every caller gets that value at once while the load goes on; callers after it has settled get the new one. The bound
   * counts from the load's start, not from each call, so a page that reads the same key twice in a row waits once. Read
   * when a load starts; a value that is not finite (Infinity) leaves that load unbounded. Without it, callers wait for
   * the load.
   */
  maxWaitMs?: number | (() => number);
  /** The oldest stored value maxWaitMs may serve (default: any the store still holds); an older one is no earlier value. */
  maxFallbackMs?: number;
  /** Whether maxWaitMs may serve this earlier value (default: any); when not, callers wait for the load. */
  fallbackWhen?: (value: T) => boolean;
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
 *
 * With `maxWaitMs` (#771), callers wait at most that long after an epoch reload starts, or the load after a memory miss
 * whose stored value could not be adopted (up to `maxFallbackMs` old): they then get the replaced entry's value or that
 * stored value (one reload behind), and the load goes on in the background. When a reload replaces an entry that is still
 * loading, that entry's own value is served once it has settled, before then its earlier value. A failed load serves the
 * earlier value too: an epoch reload puts the old entry back, a memory miss drops its entry; either way the next request
 * tries again. With nothing earlier, or one `fallbackWhen` refuses, the caller waits for the load as before.
 */
export function staleCache<T>(ttlMs: number, maxEntries = 500, options: Options<T> = {}) {
  const { epoch, store, maxStaleMs = ttlMs, weigh, maxWeight, maxWaitMs, maxFallbackMs = Infinity, fallbackWhen = () => true } = options;
  const entries = new Map<string, Entry<T>>();
  let totalWeight = 0;
  if (process.env.NODE_ENV === "production") instances.add({ size: () => entries.size, weight: () => totalWeight });
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
  // `stored` hears what the read found that is not adopted and at most maxFallbackMs old (an earlier value for
  // maxWaitMs), or null.
  const obtain = async (key: string, load: () => Promise<T>, at: number, persist: boolean, maxAgeMs: number,
    stored: (earlier: Earlier<T>) => void = () => {}): Promise<Loaded<T>> => {
    if (persist && store) {
      const row = await Promise.resolve().then(() => store.read(key)).catch(() => null);
      const adopted = row && row.epoch >= at && row.ageMs <= maxAgeMs;
      stored(row && !adopted && row.ageMs <= maxFallbackMs ? { value: row.value } : null);
      if (adopted) return { value: row.value, ageMs: Math.max(0, row.ageMs) };
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
        entry.known = { value: loaded.value };
        entry.earlier = entry.fallbackAt = undefined;
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
  // A pending entry with an earlier value: the load's result, or the earlier value once `fallbackAt` has passed and it is known.
  const serve = (entry: Entry<T>): Promise<T> => {
    const { earlier, fallbackAt = 0 } = entry;
    if (!earlier || entry.known) return entry.value;
    const wait = fallbackAt - Date.now();
    return new Promise<T>((resolve, reject) => {
      let done = false, timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (settle: () => void) => { if (!done) { done = true; clearTimeout(timer); settle(); } };
      entry.value.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      const useEarlier = () => void earlier().then(found => { if (found) finish(() => resolve(found.value)); });
      // Not unref()ed: it lives at most `wait` and is cleared when the load settles; an unref()ed timer let the test
      // runner end a test whose only pending work was this wait (CI, Node 22).
      if (wait > 0) timer = setTimeout(useEarlier, wait); else useEarlier();
    });
  };
  // What a reload replacing `entry` may serve: the value it last resolved to; while its first load is still pending, its
  // own earlier value, or (it has none) that load.
  const earlierOf = (entry: Entry<T>): Promise<Earlier<T>> => entry.known ? Promise.resolve(entry.known)
    : entry.earlier ? entry.earlier() : entry.value.then(value => ({ value }), () => null);
  const usable = (found: Earlier<T>): Earlier<T> => found && fallbackWhen(found.value) ? found : null;
  const insert = (key: string, load: () => Promise<T>, epoch: number | undefined, persist: boolean, previous?: Entry<T>) => {
    const loadedAt = Date.now();
    const bound = maxWaitMs === undefined ? Infinity : typeof maxWaitMs === "function" ? maxWaitMs() : maxWaitMs;
    // With a finite bound, what a waiting caller may get: the replaced entry's value (earlierOf), or a stored value this
    // memory miss reads but may not adopt. Read when the bound passes, so a replaced entry that settled by then counts.
    let foundStored: (found: Earlier<T>) => void = () => {};
    let earlier: (() => Promise<Earlier<T>>) | undefined;
    if (Number.isFinite(bound)) {
      if (previous) earlier = () => earlierOf(previous).then(usable);
      else if (persist && store) {
        const stored = new Promise<Earlier<T>>(resolve => { foundStored = found => resolve(usable(found)); });
        earlier = () => stored;
      }
    }
    // A memory miss may adopt a value up to maxStaleMs old; an epoch reload only one another process just computed.
    const value = obtain(key, load, epoch ?? 0, persist, previous ? ttlMs : maxStaleMs, foundStored).then(loaded => {
      fresh.known = { value: loaded.value };
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
    const fresh: Entry<T> = { value, loadedAt, refreshing: false, epoch, weight: 0, earlier, fallbackAt: earlier ? loadedAt + bound : undefined };
    if (previous) {
      // A failed reload after an epoch change serves the old value; the old entry's epoch makes the next request try again.
      fresh.value = fresh.value.catch(error => {
        console.error("Stale cache reload failed; serving the previous value", error);
        if (entries.get(key) === fresh) { drop(key); entries.set(key, previous); totalWeight += previous.weight; trim(key); }
        return previous.value;
      });
    } else if (earlier) {
      // A failed load after a memory miss serves the stored value it could not adopt; the entry goes, so the next request
      // tries again. Without such a value the error reaches the callers.
      fresh.value = fresh.value.catch(async error => {
        if (entries.get(key) === fresh) drop(key);
        const found = await earlier();
        if (!found) throw error;
        console.error("Stale cache load failed; serving the stored value", error);
        return found.value;
      });
    } else {
      // A failed first load is not cached: the next request tries again.
      fresh.value.catch(() => { if (entries.get(key) === fresh) drop(key); });
    }
    // Settled: later callers get the value directly, and the replaced entry is no longer held. Both handlers, so a
    // failure is not reported as unhandled here.
    if (earlier) { const settled = () => { fresh.earlier = fresh.fallbackAt = undefined; }; fresh.value.then(settled, settled); }
    drop(key);
    entries.set(key, fresh);
    if (entries.size > maxEntries) drop(entries.keys().next().value!);
    return serve(fresh);
  };
  const read = (key: string, load: () => Promise<T>, epoch: number | undefined, persist: boolean): Promise<T> => {
    const entry = entries.get(key);
    if (!entry) return insert(key, load, epoch, persist);
    // An entry from an older epoch is stale; one from a newer epoch (a racing read saw the bump first) is kept.
    if (epoch !== undefined && (entry.epoch === undefined || entry.epoch < epoch)) return insert(key, load, epoch, persist, entry);
    // Map order doubles as recency for eviction.
    entries.delete(key); entries.set(key, entry);
    if (!entry.refreshing && Date.now() - entry.loadedAt > ttlMs) refresh(key, entry, load, epoch ?? 0, persist);
    return serve(entry);
  };
  return (key: string, load: () => Promise<T>, { persist = true }: { persist?: boolean } = {}): Promise<T> => {
    const shared = persist && Boolean(store);
    return epoch ? epoch().then(current => read(key, load, current, shared)) : read(key, load, undefined, shared);
  };
}
