interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 60;
const DEFAULT_MAX_ENTRIES = 500;

function getTtl(): number {
  const envVal = parseInt(process.env.SEARCH_CACHE_TTL_SECONDS ?? "", 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_TTL_SECONDS;
}

function getMaxEntries(): number {
  const envVal = parseInt(process.env.SEARCH_CACHE_MAX_ENTRIES ?? "", 10);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : DEFAULT_MAX_ENTRIES;
}

const cache = new Map<string, CacheEntry<unknown>>();

function isEnabled(): boolean {
  return process.env.SEARCH_CACHE_ENABLED !== "false";
}

function purgeExpired(): void {
  const max = getMaxEntries();
  if (cache.size <= max) return;
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
  if (cache.size > max) {
    const entries = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = entries.slice(0, cache.size - max);
    for (const [key] of toDelete) {
      cache.delete(key);
    }
  }
}

function buildKey(params: {
  query: string;
  page: number;
  limit: number;
  supplier?: string;
  brand?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  includeFacets?: boolean;
  includeOems?: boolean;
  catalogSource?: string;
}): string {
  const parts = [
    params.query.toLowerCase().trim(),
    `p${params.page}`,
    `l${params.limit}`,
    params.supplier ?? "",
    params.brand ?? "",
    params.inStock === true ? "inStock" : params.inStock === false ? "noStock" : "",
    params.minPrice != null ? `min${params.minPrice}` : "",
    params.maxPrice != null ? `max${params.maxPrice}` : "",
    params.sort ?? "",
    params.includeFacets ? "facets" : "",
    params.includeOems ? "oems" : "",
    params.catalogSource ?? "",
  ];
  return `db:${parts.join("|")}`;
}

export function getCachedSearchResult<T>(params: {
  query: string;
  page: number;
  limit: number;
  supplier?: string;
  brand?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  includeFacets?: boolean;
  includeOems?: boolean;
  catalogSource?: string;
}): T | null {
  if (!isEnabled()) return null;
  const key = buildKey(params);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setCachedSearchResult<T>(params: {
  query: string;
  page: number;
  limit: number;
  supplier?: string;
  brand?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  includeFacets?: boolean;
  includeOems?: boolean;
  catalogSource?: string;
}, value: T): void {
  if (!isEnabled()) return;
  const key = buildKey(params);
  cache.set(key, {
    value,
    expiresAt: Date.now() + getTtl() * 1000,
  });
  purgeExpired();
}

export function clearSearchCache(): void {
  cache.clear();
}

export function getSearchCacheStats(): { size: number; ttlSeconds: number; maxEntries: number; enabled: boolean } {
  return {
    size: cache.size,
    ttlSeconds: getTtl(),
    maxEntries: getMaxEntries(),
    enabled: isEnabled(),
  };
}