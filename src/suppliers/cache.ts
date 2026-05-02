/**
 * v0.2.0 Simple in-memory TTL cache for search results.
 * Cache key includes query + supplier mode to avoid stale data when mode changes.
 * Only successful normalized results are cached; errors are never cached.
 * Redis can be added later for multi-instance caching.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 60;

function getTtlMs(): number {
  const envVal = parseInt(process.env.SEARCH_CACHE_TTL_SECONDS ?? "", 10);
  const ttl = Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_TTL_SECONDS;
  return ttl * 1000;
}

const cache = new Map<string, CacheEntry<unknown>>();

function makeKey(query: string, mode: string): string {
  return `search:${mode}:${query.toLowerCase().trim()}`;
}

export function getCachedResult<T>(query: string, mode: string): T | null {
  const key = makeKey(query, mode);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCachedResult<T>(query: string, mode: string, value: T): void {
  const key = makeKey(query, mode);
  cache.set(key, {
    value,
    expiresAt: Date.now() + getTtlMs(),
  });
}

export function clearSearchCache(): void {
  cache.clear();
}

export function getCacheStats(): { size: number; ttlMs: number } {
  return { size: cache.size, ttlMs: getTtlMs() };
}