/** What a cache did since the process started (#1461): reads served from memory, served stale, loaded, adopted from the store, evicted. */
export type Counters = { hits: number; stale: number; misses: number; reloads: number; adopted: number; evicted: number };
export type CacheInstance = { name: string; size: () => number; weight: () => number; counters: Counters; clear: () => void };
// Next bundles instrumentation.ts (which logs the stats) apart from the route handlers (which create the caches), so a
// module-level set would be empty where it is read. Instances are registered only in production, where every cache is
// created at module level (a bounded number), so a dev re-evaluation pins nothing. Not WeakRefs: the SWC minifier
// inlines the instance object into the WeakRef and the registry empties after one GC.
const globalInstances = globalThis as typeof globalThis & { __staleCacheInstances?: Set<CacheInstance> };
export const cacheInstances = (globalInstances.__staleCacheInstances ??= new Set<CacheInstance>());

export const newCounters = (): Counters => ({ hits: 0, stale: 0, misses: 0, reloads: 0, adopted: 0, evicted: 0 });

/** Lists an entry-only cache (ttl-cache.ts) in the memory log; production only, like the stale caches. */
export function registerEntries(name: string | undefined, size: () => number, clear: () => void) {
  if (!name || process.env.NODE_ENV !== "production") return;
  cacheInstances.add({ name, size, weight: () => 0, counters: newCounters(), clear });
}
