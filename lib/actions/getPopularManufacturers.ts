'use server'

import { db } from '@/lib/db'
import { getFromCache, setCache } from '@/lib/redis'
import { unstable_cache } from 'next/cache'
import { createTimerGroup } from '@/lib/performance/timing'

export interface PopularManufacturer {
  id: number
  name: string
  logoUrl: string | null
}

const POPULAR_MANUFACTURERS_CACHE_KEY = 'popular-manufacturers-v1'
const POPULAR_MANUFACTURERS_CACHE_TTL = 3600

async function fetchPopularManufacturersFromDB(): Promise<PopularManufacturer[]> {
  const brands = await db.part_brands.findMany({
    where: {
      logo_url: { not: null }
    },
    select: {
      id: true,
      name: true,
      logo_url: true
    },
    orderBy: { name: 'asc' },
    take: 48
  })

  return brands.map((b) => ({
    id: b.id,
    name: b.name,
    logoUrl: b.logo_url
  }))
}

export const getPopularManufacturers = unstable_cache(
  async (): Promise<PopularManufacturer[]> => {
    const tg = createTimerGroup('popularManufacturers')
    const tCache = tg.start('redisLookup')

    const cached = await getFromCache<PopularManufacturer[]>(POPULAR_MANUFACTURERS_CACHE_KEY)
    if (cached) {
      tg.end(tCache, { hit: true })
      tg.logSummary()
      return cached
    }
    tg.end(tCache, { hit: false })

    const result = await fetchPopularManufacturersFromDB()

    const tCacheSet = tg.start('redisSet')
    await setCache(POPULAR_MANUFACTURERS_CACHE_KEY, result, POPULAR_MANUFACTURERS_CACHE_TTL).catch(() => {})
    tg.end(tCacheSet)

    tg.logSummary()
    return result
  },
  ['popular-manufacturers-v2'],
  { revalidate: 3600 }
)
