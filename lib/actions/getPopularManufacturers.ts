'use server'

import { db } from '@/lib/db'
import { getFromCache, setCache } from '@/lib/redis'
import { createTimerGroup } from '@/lib/performance/timing'

export interface PopularManufacturer {
  id: number
  name: string
  logoUrl: string | null
}

const POPULAR_MANUFACTURERS_CACHE_KEY = 'popular-manufacturers-v1'
const POPULAR_MANUFACTURERS_CACHE_TTL = 3600

export async function getPopularManufacturers(): Promise<
  PopularManufacturer[]
> {
  const tg = createTimerGroup('popularManufacturers')
  const tCache = tg.start('cacheLookup')

  const cached = await getFromCache<PopularManufacturer[]>(POPULAR_MANUFACTURERS_CACHE_KEY)
  if (cached) {
    tg.end(tCache, { hit: true })
    tg.logSummary()
    return cached
  }
  tg.end(tCache, { hit: false })

  const tDb = tg.start('dbQuery')
  const brands = await db.part_brands.findMany({
    where: {
      logo_url: { not: null }
    },
    select: {
      id: true,
      name: true,
      logo_url: true
    },
    orderBy: { name: 'asc' }
  })
  tg.end(tDb)

  const result = brands.map((b) => ({
    id: b.id,
    name: b.name,
    logoUrl: b.logo_url
  }))

  const tCacheSet = tg.start('cacheSet')
  await setCache(POPULAR_MANUFACTURERS_CACHE_KEY, result, POPULAR_MANUFACTURERS_CACHE_TTL).catch(() => {})
  tg.end(tCacheSet)

  tg.logSummary()
  return result
}
