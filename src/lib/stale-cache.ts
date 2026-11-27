import "server-only";
import { cacheInstances, newCounters, type CacheInstance, type Counters } from "@/lib/cache-registry";

/** An earlier value callers of a pending load may get after maxWaitMs; null when there is none they may get. */
type Earlier<T> = { value: T } | null;
/**
 * `known`: the value the entry last resolved to (unset while its first load is pending). `value` is the pending load and
 * is cleared once `known` is set (#1461): a settled entry holds the plain value, no Promise. On Node 22 (AsyncLocalStorage
 * on async_hooks) every Promise created inside a request keeps the request's async context alive, with Next's stores and
 * React's per-request caches; a cached Promise pinned all of them for the life of the entry. `earlier` and `fallbackAt`
 * (when it may be served) are set only while a load with a finite maxWaitMs is pending.
 */
type Entry<T> = {
  value?: Promise<T>; loadedAt: number; usedAt: number; refreshing: boolean; epoch?: number; weight: number; known?: { value: T };
  earlier?: () => Promise<Earlier<T>>; fallbackAt?: number;
};
export type { Counters } from "@/lib/cache-registry";
/**
 * Approximate heap bytes of a cached value, for `weigh` (#1461): a uuid string is about 56 bytes plus an 8-byte slot, a
 * string array adds 24 bytes of header, and a small object is counted as twice its JSON length. `weighJson` is for small
 * values only (it serialises the value); a large value needs its own estimate.
 */
export const weighIds = (ids: readonly string[]) => 64 * ids.length;
export const weighStrings = (list: readonly string[]) => list.reduce((sum, item) => sum + item.length + 8, 24);
export const weighJson = (value: unknown) => 2 * JSON.stringify(value).length;
export const weighBuffer = (buffer: Uint8Array) => buffer.length;
/** What a settled entry weighs when the cache has no `weigh`, and the part of every entry that is its key's text. */
const baseWeight = 128;

// Process-wide budget (#1461): after a load, while every stale cache together weighs more than STALE_CACHE_MAX_MB, the
// globally least recently used settled entry goes. The tick orders entries across caches; it lives on globalThis like the registry.
const globalBudget = globalThis as typeof globalThis & { __staleCacheTick?: number };
const nextTick = () => (globalBudget.__staleCacheTick = (globalBudget.__staleCacheTick ?? 0) + 1);
/** Entries lighter than this are not worth evicting for the budget: the many small ones are bounded by maxEntries. */
const budgetMinWeight = 4096;
const budgetBytes = () => {
  const setting = process.env.STALE_CACHE_MAX_MB?.trim();
  const mb = setting ? Number(setting) : 256;
  return (Number.isFinite(mb) && mb >= 0 ? mb : 256) * 1048576;
};
function enforceBudget(keep: { instance: CacheInstance; key: string }) {
  const limit = budgetBytes();
  if (limit === 0) return;
  for (;;) {
    let total = 0;
    for (const instance of cacheInstances) total += instance.weight();
    if (total <= limit) return;
    let victim: { usedAt: number; evict: () => void } | undefined;
    for (const instance of cacheInstances) {
      const found = instance.oldest?.(budgetMinWeight, instance === keep.instance ? keep.key : undefined);
      if (found && (!victim || found.usedAt < victim.usedAt)) victim = found;
    }
    if (!victim) return;
    victim.evict();
  }
}

/** Per-cache numbers of one stale cache, see `staleCacheStats`. */
export type CacheStats = Counters & { name: string; entries: number; weight: number };
/**
 * Entries, summed weight and counters over every stale cache of this process, for the memory log line (#1262), and the
 * same per cache (#1461). `caches` also lists the entry-only caches of ttl-cache.ts.
 */
export function staleCacheStats() {
  const caches: CacheStats[] = [];
  const total = { entries: 0, weight: 0, hits: 0, stale: 0, misses: 0, reloads: 0, adopted: 0, evicted: 0 };
  for (const instance of cacheInstances) {
    const stats = { name: instance.name, entries: instance.size(), weight: instance.weight(), ...instance.counters };
    caches.push(stats);
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += stats[key];
  }
  return { ...total, caches };
}
/** Empties every registered cache one by one, handing each to `each` (the memory probe, #1461). */
export function clearStaleCaches(each: (name: string, entries: number, weight: number, clear: () => void) => void) {
  for (const instance of [...cacheInstances]) each(instance.name, instance.size(), instance.weight(), instance.clear);
}
/** A value read from a store, or loaded now (`ageMs` undefined: its age is counted from the load). */
type Loaded<T> = { value: T; ageMs?: number };
/** A second cache level shared by every process (src/modules/store/listing-cache-store.ts). Values must survive JSON. */
export type StaleCacheStore<T> = {
  /** The stored value, its age by the store's clock and the epoch it was loaded under; null when there is none. */
  read(key: string): Promise<{ value: T; ageMs: number; epoch: number } | null>;
  write(key: string, value: T, epoch: number): Promise<void>;
};
/** Per-call options of the function staleCache returns. */
type CallOptions = {
  persist?: boolean; epoch?: () => Promise<number>;
  /**
   * A hard bound on the age of the value this call may be served (#1453), counted from the entry's `loadedAt` (an adopted
   * stored value counts its stored age); 0 or unset: none, the default behaviour. An entry older than it is not served
   * stale: the caller awaits a reload, as for a cold key, and concurrent callers share that one load (the reload is
   * the entry; later callers find it pending). It also bounds what a miss may take from the store (maxStaleMs) and what
   * maxWaitMs may serve as an earlier value (a stored row, or the entry an epoch bump replaced): a value older than it is
   * never served at once. If the reload of an over-age entry fails, the old value is served after all, with a logged error,
   * and the next request tries again: a stale page beats an error page. A cold key (nothing to serve) still gets the error.
   * So does a failed reload after an epoch bump, which restores the previous entry whatever its age (existing behaviour).
   */
  maxServeMs?: number;
};
/**
 * A load: `at` is the epoch value the entry is loaded under (0 without an epoch), the one a stored value is written with.
 * A load that tags data of its own with an epoch (a stored price order) uses this value, so the tag and the entry agree.
 */
type Load<T> = (at: number) => Promise<T>;
type Options<T> = {
  /**
   * Shared invalidation counter (src/modules/store/listing-epoch.ts): an entry loaded under an older value is reloaded.
   * A call may name its own (the call's `epoch`), which then replaces this one for that call.
   */
  epoch?: () => Promise<number>;
  /** Optional second level read on a memory miss and written after every load. Its errors count as a miss. */
  store?: StaleCacheStore<T>;
  /** The oldest stored value a memory miss may adopt (default: ttlMs); older ones are loaded again. */
  maxStaleMs?: number;
  /** Name in the memory log and the cache probe (#1461); default `cache#<n>`. */
  name?: string;
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
 * A call may pass its own `epoch` (#1368): one cache then serves keys that follow different counters (the listings that
 * read vehicle fits and those that do not). A key must always be read with the same counter: its entry and stored value
 * carry that counter's value, which another counter's would not compare with. The load gets the value it runs under (`at`).
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
let unnamed = 0;
export function staleCache<T>(ttlMs: number, maxEntries = 500, options: Options<T> = {}) {
  const { name = `cache#${++unnamed}`, epoch, store, maxStaleMs = ttlMs, weigh, maxWeight, maxWaitMs, maxFallbackMs = Infinity, fallbackWhen = () => true } = options;
  const entries = new Map<string, Entry<T>>();
  let totalWeight = 0;
  const counters = newCounters();
  const instance: CacheInstance = {
    name, size: () => entries.size, weight: () => totalWeight, counters, clear: () => { entries.clear(); totalWeight = 0; },
    oldest: (minWeight, skip) => {
      // Map order is recency order, so the first match is this cache's oldest.
      for (const [key, entry] of entries) {
        if (key !== skip && entry.known && entry.weight >= minWeight) return { usedAt: entry.usedAt, evict: () => drop(key, true) };
      }
      return undefined;
    },
  };
  if (process.env.NODE_ENV === "production") cacheInstances.add(instance);
  const drop = (key: string, evicted = false) => {
    const entry = entries.get(key);
    if (!entry) return;
    totalWeight -= entry.weight;
    entries.delete(key);
    if (evicted) counters.evicted++;
  };
  const measure = (key: string, value: T) => (weigh ? weigh(value) : baseWeight) + key.length;
  // Called after a load: the oldest entries go while the total is over the bound; `keep` (the loaded one) stays.
  const trim = (keep: string) => {
    if (maxWeight !== undefined) trimToMax(keep, maxWeight);
    enforceBudget({ instance, key: keep });
  };
  const trimToMax = (keep: string, bound: number) => {
    for (const key of entries.keys()) {
      if (totalWeight <= bound || entries.size <= 1) return;
      // A pending entry (weight 0) frees nothing, and dropping it would make its next reader load the value again.
      if (key !== keep && entries.get(key)!.weight > 0) drop(key, true);
    }
  };
  // Reads the store first when `persist`; a stored value is adopted when its epoch is current and it is at most `maxAgeMs` old.
  // `stored` hears what the read found that is not adopted and at most maxFallbackMs old (an earlier value for
  // maxWaitMs), or null.
  const obtain = async (key: string, load: Load<T>, at: number, persist: boolean, maxAgeMs: number,
    stored: (earlier: Earlier<T>) => void = () => {}, fallbackMs = maxFallbackMs): Promise<Loaded<T>> => {
    if (persist && store) {
      const row = await Promise.resolve().then(() => store.read(key)).catch(() => null);
      const adopted = row && row.epoch >= at && row.ageMs <= maxAgeMs;
      stored(row && !adopted && row.ageMs <= fallbackMs ? { value: row.value } : null);
      if (adopted) return { value: row.value, ageMs: Math.max(0, row.ageMs) };
    }
    const value = await load(at);
    if (persist && store) Promise.resolve().then(() => store.write(key, value, at)).catch(() => {});
    return { value };
  };
  const refresh = (key: string, entry: Entry<T>, load: Load<T>, at: number, persist: boolean) => {
    entry.refreshing = true;
    obtain(key, load, at, persist, ttlMs)
      .then(loaded => {
        entry.value = undefined;
        if (loaded.ageMs !== undefined) counters.adopted++;
        entry.known = { value: loaded.value };
        entry.earlier = entry.fallbackAt = undefined;
        entry.loadedAt = Date.now() - (loaded.ageMs ?? 0);
        // An entry evicted while it refreshed is no longer counted.
        if (entries.get(key) === entry) {
          const weight = measure(key, loaded.value);
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
    if (entry.known) return Promise.resolve(entry.known.value);
    const pending = entry.value!;
    if (!earlier) return pending;
    const wait = fallbackAt - Date.now();
    return new Promise<T>((resolve, reject) => {
      let done = false, timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (settle: () => void) => { if (!done) { done = true; clearTimeout(timer); settle(); } };
      pending.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      const useEarlier = () => void earlier().then(found => { if (found) finish(() => resolve(found.value)); });
      // Not unref()ed: it lives at most `wait` and is cleared when the load settles; an unref()ed timer let the test
      // runner end a test whose only pending work was this wait (CI, Node 22).
      if (wait > 0) timer = setTimeout(useEarlier, wait); else useEarlier();
    });
  };
  // What a reload replacing `entry` may serve: the value it last resolved to; while its first load is still pending, its
  // own earlier value, or (it has none) that load.
  const earlierOf = (entry: Entry<T>): Promise<Earlier<T>> => entry.known ? Promise.resolve(entry.known)
    : entry.earlier ? entry.earlier() : entry.value!.then(value => ({ value }), () => null);
  const usable = (found: Earlier<T>): Earlier<T> => found && fallbackWhen(found.value) ? found : null;
  // `maxServe` (CallOptions.maxServeMs, 0: none) bounds the age of anything this load's callers are served before it settles.
  // `overAge`: `previous` is older than that, so it is no earlier value to wait past: callers wait for the load (its failure
  // still serves `previous`).
  const insert = (key: string, load: Load<T>, epoch: number | undefined, persist: boolean, previous?: Entry<T>, maxServe = 0, overAge = false) => {
    const loadedAt = Date.now();
    const bound = overAge ? Infinity : maxWaitMs === undefined ? Infinity : typeof maxWaitMs === "function" ? maxWaitMs() : maxWaitMs;
    const youngEnough = (ageMs: number) => !maxServe || ageMs <= maxServe;
    // With a finite bound, what a waiting caller may get: the replaced entry's value (earlierOf), or a stored value this
    // memory miss reads but may not adopt. Read when the bound passes, so a replaced entry that settled by then counts.
    let foundStored: (found: Earlier<T>) => void = () => {};
    let earlier: (() => Promise<Earlier<T>>) | undefined;
    if (Number.isFinite(bound)) {
      if (previous) earlier = () => earlierOf(previous).then(found => youngEnough(Date.now() - previous.loadedAt) ? usable(found) : null);
      else if (persist && store) {
        const stored = new Promise<Earlier<T>>(resolve => { foundStored = found => resolve(usable(found)); });
        earlier = () => stored;
      }
    }
    // A memory miss may adopt a value up to maxStaleMs old; an epoch reload only one another process just computed.
    const value = obtain(key, load, epoch ?? 0, persist, Math.min(previous ? ttlMs : maxStaleMs, maxServe || Infinity), foundStored,
      Math.min(maxFallbackMs, maxServe || Infinity)).then(loaded => {
      fresh.known = { value: loaded.value };
      fresh.value = undefined;
      if (loaded.ageMs !== undefined) {
        counters.adopted++;
        fresh.loadedAt = Date.now() - loaded.ageMs;
        // An adopted value past the TTL is served now and refreshed once in the background.
        if (loaded.ageMs > ttlMs && entries.get(key) === fresh) refresh(key, fresh, load, epoch ?? 0, persist);
      }
      if (entries.get(key) === fresh) {
        // A refresh of this pending entry may have set a weight already: count only the difference.
        const weight = measure(key, loaded.value);
        totalWeight += weight - fresh.weight;
        fresh.weight = weight;
        trim(key);
      }
      return loaded.value;
    });
    const fresh: Entry<T> = { value, loadedAt, usedAt: nextTick(), refreshing: false, epoch, weight: 0, earlier, fallbackAt: earlier ? loadedAt + bound : undefined };
    if (previous) {
      // A failed reload after an epoch change serves the old value; the old entry's epoch makes the next request try again.
      fresh.value = fresh.value!.catch(error => {
        console.error("Stale cache reload failed; serving the previous value", error);
        if (entries.get(key) === fresh) { drop(key); entries.set(key, previous); totalWeight += previous.weight; trim(key); }
        return previous.known ? previous.known.value : previous.value!;
      });
    } else if (earlier) {
      // A failed load after a memory miss serves the stored value it could not adopt; the entry goes, so the next request
      // tries again. Without such a value the error reaches the callers.
      fresh.value = fresh.value!.catch(async error => {
        if (entries.get(key) === fresh) drop(key);
        const found = await earlier();
        if (!found) throw error;
        console.error("Stale cache load failed; serving the stored value", error);
        return found.value;
      });
    } else {
      // A failed first load is not cached: the next request tries again.
      fresh.value!.catch(() => { if (entries.get(key) === fresh) drop(key); });
    }
    // Settled: later callers get the value directly, and the replaced entry is no longer held. Both handlers, so a
    // failure is not reported as unhandled here.
    if (earlier) { const settled = () => { fresh.earlier = fresh.fallbackAt = undefined; }; fresh.value!.then(settled, settled); }
    drop(key);
    entries.set(key, fresh);
    if (entries.size > maxEntries) drop(entries.keys().next().value!, true);
    return serve(fresh);
  };
  const read = (key: string, load: Load<T>, epoch: number | undefined, persist: boolean, maxServe: number): Promise<T> => {
    const entry = entries.get(key);
    if (!entry) { counters.misses++; return insert(key, load, epoch, persist, undefined, maxServe); }
    // An entry from an older epoch is stale; one from a newer epoch (a racing read saw the bump first) is kept.
    if (epoch !== undefined && (entry.epoch === undefined || entry.epoch < epoch)) { counters.reloads++; return insert(key, load, epoch, persist, entry, maxServe); }
    // A settled entry past the hard bound is reloaded before it is served (#1453); a pending one is young by construction.
    // A TTL refresh already running when the entry crosses the bound is not reused: a duplicate load is possible within one refresh's duration.
    if (maxServe && entry.known && Date.now() - entry.loadedAt > maxServe) { counters.reloads++; return insert(key, load, epoch, persist, entry, maxServe, true); }
    // Map order doubles as recency for eviction.
    entry.usedAt = nextTick();
    entries.delete(key); entries.set(key, entry);
    if (Date.now() - entry.loadedAt > ttlMs) {
      counters.stale++;
      if (!entry.refreshing) refresh(key, entry, load, epoch ?? 0, persist);
    } else counters.hits++;
    return serve(entry);
  };
  return (key: string, load: Load<T>, { persist = true, epoch: own, maxServeMs }: CallOptions = {}): Promise<T> => {
    const shared = persist && Boolean(store), source = own ?? epoch, maxServe = maxServeMs !== undefined && maxServeMs > 0 ? maxServeMs : 0;
    return source ? source().then(current => read(key, load, current, shared, maxServe)) : read(key, load, undefined, shared, maxServe);
  };
}
