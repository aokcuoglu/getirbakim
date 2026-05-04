'use server'

import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { getCategorySearchIdFromUrlKey } from './getPartCategories'

interface GetBrandsParams {
  vehicleTypeId?: number
  categoryUrlKey?: string
}

export interface BrandCount {
  name: string
  count: number
}

/**
 * Cached function to get category searchId from urlKey
 * Cache for 1 hour to avoid repeated DB lookups
 */
const getCategorySearchIdForBrands = unstable_cache(
  async (categoryUrlKey: string): Promise<number | null> => {
    return getCategorySearchIdFromUrlKey(categoryUrlKey)
  },
  ['brands-category-search-id-v2'],
  { revalidate: 3600 }
)

/**
 * Cached function to get brands for a category (no vehicle filter)
 * Cache for 1 hour since brand counts rarely change
 */
const getCachedBrandsForCategory = unstable_cache(
  async (categorySearchId: number): Promise<BrandCount[]> => {
    const results = await db.parts.groupBy({
      by: ['brand_id'],
      where: { category_id: categorySearchId },
      _count: { id: true }
    })

    // Fetch brand names for grouped results
    const brandIds = results.map((r) => r.brand_id)
    const brands = await db.part_brands.findMany({
      where: { id: { in: brandIds } },
      select: { id: true, name: true }
    })

    const brandMap = new Map(brands.map((b) => [b.id, b.name]))

    return results
      .map((r) => ({
        name: brandMap.get(r.brand_id) || 'Unknown',
        count: r._count.id
      }))
      .sort((a, b) => b.count - a.count)
  },
  ['brands-for-category'],
  { revalidate: 3600 }
)

export async function getBrandsForCategory({
  vehicleTypeId,
  categoryUrlKey
}: GetBrandsParams): Promise<BrandCount[]> {
  try {
    let categorySearchId: number | null = null

    if (categoryUrlKey) {
      categorySearchId = await getCategorySearchIdForBrands(categoryUrlKey)

      // If category requested but not found, return empty
      if (!categorySearchId) {
        return []
      }
    }

    let partIds: bigint[] = []

    // If no vehicle filter, use the cached brands query
    if (!vehicleTypeId && categorySearchId) {
      return getCachedBrandsForCategory(categorySearchId)
    }

    if (vehicleTypeId) {
      const variant = await db.variants.findFirst({
        where: { id: vehicleTypeId }
      })

      if (variant?.tecdoc_id) {
        const vehicleParts = await db.part_vehicle_types.findMany({
          where: { vehicle_type_id: variant.tecdoc_id },
          select: { part_id: true }
        })

        partIds = vehicleParts.map((p) => p.part_id)
        if (partIds.length === 0) return []
      } else {
        return []
      }
    }

    // Build where condition
    const whereCondition: {
      category_id?: number
      id?: { in: bigint[] }
    } = {}

    if (categorySearchId) {
      whereCondition.category_id = categorySearchId
    }
    if (partIds.length > 0) {
      whereCondition.id = { in: partIds }
    }

    const results = await db.parts.groupBy({
      by: ['brand_id'],
      where: whereCondition,
      _count: { id: true }
    })

    // Fetch brand names
    const brandIds = results.map((r) => r.brand_id)
    const brands = await db.part_brands.findMany({
      where: { id: { in: brandIds } },
      select: { id: true, name: true }
    })

    const brandMap = new Map(brands.map((b) => [b.id, b.name]))

    return results
      .map((r) => ({
        name: brandMap.get(r.brand_id) || 'Unknown',
        count: r._count.id
      }))
      .sort((a, b) => b.count - a.count)
  } catch (error) {
    console.error('Error fetching brands for category:', error)
    return []
  }
}
