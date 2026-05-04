/**
 * Simple in-memory cache implementation for admin API routes
 * In production, consider using Redis or a similar caching solution
 */

// In-memory cache store
const cacheStore = new Map<string, { value: unknown; expiresAt: number }>()

/**
 * Cache keys for different data types
 */
export const cacheKeys = {
  stats: (period: string) => `cache:stats:${period}`,
  product: (id: string | number) => `cache:product:${id}`,
  products: (query: string) => `cache:products:${query}`,
  search: (query: string) => `cache:search:${query}`,
  categories: () => 'cache:categories'
}

/**
 * Cache TTL (Time To Live) in seconds
 */
export const cacheTTL = {
  stats: 60, // 1 minute
  product: 300, // 5 minutes
  products: 60, // 1 minute
  search: 60, // 1 minute
  categories: 300 // 5 minutes
}

/**
 * Get a cached value
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const cached = cacheStore.get(key)

  if (!cached) {
    return null
  }

  // Check if expired
  if (Date.now() > cached.expiresAt) {
    cacheStore.delete(key)
    return null
  }

  return cached.value as T
}

/**
 * Set a cached value with TTL in seconds
 */
export async function setCached<T>(
  key: string,
  value: T,
  ttlSeconds: number = 60
): Promise<void> {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  })
}

/**
 * Delete a specific cached value
 */
export async function deleteCached(key: string): Promise<void> {
  cacheStore.delete(key)
}

/**
 * Delete cached values matching a pattern (simple glob-like matching)
 */
export async function deleteCachedPattern(pattern: string): Promise<void> {
  // Convert glob pattern to regex
  const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.')
  const regex = new RegExp(`^${regexPattern}$`)

  const keys = Array.from(cacheStore.keys())
  for (const key of keys) {
    if (regex.test(key)) {
      cacheStore.delete(key)
    }
  }
}

/**
 * Clear all cached values
 */
export async function clearCache(): Promise<void> {
  cacheStore.clear()
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number; keys: string[] } {
  return {
    size: cacheStore.size,
    keys: Array.from(cacheStore.keys())
  }
}
