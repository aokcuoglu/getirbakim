import { Redis } from '@upstash/redis'

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN
      })
    : null

export { redis }

export function isRedisAvailable(): boolean {
  return redis !== null
}

export async function getFromCache<T>(key: string): Promise<T | null> {
  if (!redis) return null
  try {
    const data = await redis.get<T>(key)
    return data ?? null
  } catch (err) {
    console.warn('[redis] getFromCache failed:', err)
    return null
  }
}

export async function setCache<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<boolean> {
  if (!redis) return false
  try {
    await redis.set(key, value, { ex: ttlSeconds })
    return true
  } catch (err) {
    console.warn('[redis] setCache failed:', err)
    return false
  }
}

export async function deleteCache(key: string): Promise<boolean> {
  if (!redis) return false
  try {
    await redis.del(key)
    return true
  } catch (err) {
    console.warn('[redis] deleteCache failed:', err)
    return false
  }
}

export async function deleteCachePattern(pattern: string): Promise<boolean> {
  if (!redis) return false
  try {
    let cursor = 0
    do {
      const result = await redis.scan(cursor, { match: pattern, count: 100 })
      cursor = Number(result[0])
      const keys = result[1]
      if (keys.length > 0) {
        await redis.del(...(keys as string[]))
      }
    } while (cursor !== 0)
    return true
  } catch (err) {
    console.warn('[redis] deleteCachePattern failed:', err)
    return false
  }
}
