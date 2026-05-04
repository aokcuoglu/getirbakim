'use server'

import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'

/**
 * Get popular part IDs for ISR (Incremental Static Regeneration)
 * 
 * Uses order_items to find most popular parts (most sold = most popular)
 * Falls back to recently created parts if no orders exist
 */
export async function getPopularPartIds(limit: number = 1000): Promise<number[]> {
  return unstable_cache(
    async (limit: number) => {
      try {
        // Prisma-first: simple aggregation is kept in ORM for maintainability.
        const popularParts = await db.order_items.groupBy({
          by: ['part_id'],
          _count: {
            _all: true
          },
          orderBy: {
            _count: {
              part_id: 'desc'
            }
          },
          take: limit
        })

        if (popularParts.length > 0) {
          return popularParts.map((p) => Number(p.part_id))
        }

        // Fallback: Get recently created parts
        const recentParts = await db.parts.findMany({
          orderBy: { created_at: 'desc' },
          take: limit,
          select: { id: true }
        })

        return recentParts.map((p) => Number(p.id))
      } catch (error) {
        console.error('Error fetching popular part IDs:', error)
        // Fallback: Get any parts (limit to avoid too many)
        const anyParts = await db.parts.findMany({
          take: Math.min(limit, 500),
          select: { id: true }
        })
        return anyParts.map((p) => Number(p.id))
      }
    },
    ['popular-part-ids'],
    { revalidate: 3600 } // Revalidate every hour
  )(limit)
}
