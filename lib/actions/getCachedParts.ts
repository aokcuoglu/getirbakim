'use server'

import { unstable_cache } from 'next/cache'
import { db } from '@/lib/db'
import { getCategorySearchIdFromUrlKey } from './getPartCategories'

export interface CachedPartWithDetails {
  id: number
  name: string
  price: string | null
  brand: {
    id: number
    name: string
    logoUrl: string | null
  }
  images: {
    image: string | null
    thumb: string | null
  }[]
  properties: {
    key: string
    value: string
  }[]
  eans: string[]
}

/**
 * Cached function to get category searchId from urlKey
 */
const getCategorySearchId = unstable_cache(
  async (categoryUrlKey: string): Promise<number | null> => {
    return getCategorySearchIdFromUrlKey(categoryUrlKey)
  },
  ['category-search-id-v3'],
  { revalidate: 3600 }
)

/**
 * Cached function to get tecdocId from variant ID
 */
const getVariantTecdocId = unstable_cache(
  async (vehicleTypeId: number): Promise<number | null> => {
    const variant = await db.variants.findFirst({
      where: { id: vehicleTypeId }
    })
    return variant?.tecdoc_id ?? null
  },
  ['variant-tecdoc-id'],
  { revalidate: 3600 }
)

/**
 * Cached function to get part IDs for a vehicle type
 */
const getVehiclePartIds = unstable_cache(
  async (tecdocId: number): Promise<bigint[]> => {
    const vehicleParts = await db.part_vehicle_types.findMany({
      where: { vehicle_type_id: tecdocId },
      select: { part_id: true }
    })
    return vehicleParts.map((p) => p.part_id)
  },
  ['vehicle-part-ids'],
  { revalidate: 3600 }
)

/**
 * Internal function to fetch parts by IDs with relations
 */
async function fetchPartsByIds(
  partIds: bigint[],
  categorySearchId: number | null,
  page: number,
  limit: number
): Promise<{
  parts: CachedPartWithDetails[]
  total: number
  totalPages: number
}> {
  const start = performance.now()
  const offset = (page - 1) * limit

  // Build where condition
  const whereCondition: {
    id: { in: bigint[] }
    category_id?: number
  } = { id: { in: partIds } }

  if (categorySearchId) {
    whereCondition.category_id = categorySearchId
  }

  // Get parts with relations
  const partsWithDetails = await db.parts.findMany({
    where: whereCondition,
    take: limit,
    skip: offset,
    include: {
      part_brands: true,
      part_images: true,
      part_properties: true,
      part_eans: true
    }
  })

  if (partsWithDetails.length === 0) {
    return { parts: [], total: 0, totalPages: 0 }
  }

  // Get count
  const total = await db.parts.count({ where: whereCondition })

  // Transform to result format
  const result: CachedPartWithDetails[] = partsWithDetails.map((part) => ({
    id: Number(part.id),
    name: part.name,
    price: part.price?.toString() ?? null,
    brand: {
      id: part.part_brands.id,
      name: part.part_brands.name,
      logoUrl: part.part_brands.logo_url
    },
    images: part.part_images.map((img) => ({
      image: img.image,
      thumb: img.thumb
    })),
    properties: part.part_properties.map((prop) => ({
      key: prop.key,
      value: prop.value
    })),
    eans: part.part_eans.map((ean) => ean.code)
  }))

  console.log(
    `[CACHED-VEHICLE] Parts query took ${(performance.now() - start).toFixed(
      0
    )}ms for ${result.length} parts`
  )

  return {
    parts: result,
    total,
    totalPages: Math.ceil(total / limit)
  }
}

/**
 * Get cached parts for a category page (SSR optimization)
 * This caches the first page of each category for 5 minutes
 */
export const getCachedPartsForCategory = async (
  categoryUrlKey: string,
  page: number = 1,
  limit: number = 48
) =>
  await unstable_cache(
    async (
      categoryUrlKey: string,
      page: number = 1,
      limit: number = 48
    ): Promise<{
      parts: CachedPartWithDetails[]
      total: number
      totalPages: number
    }> => {
      const start = performance.now()

      const categorySearchId = await getCategorySearchId(categoryUrlKey)
      if (!categorySearchId) {
        return { parts: [], total: 0, totalPages: 0 }
      }

      const offset = (page - 1) * limit

      // Use single query with includes
      const partsWithDetails = await db.parts.findMany({
        where: { category_id: categorySearchId },
        take: limit,
        skip: offset,
        include: {
          part_brands: true,
          part_images: true,
          part_properties: true,
          part_eans: true
        }
      })

      if (partsWithDetails.length === 0) {
        return { parts: [], total: 0, totalPages: 0 }
      }

      // Get count
      const total = await db.parts.count({
        where: { category_id: categorySearchId }
      })

      // Transform to result format
      const result: CachedPartWithDetails[] = partsWithDetails.map((part) => ({
        id: Number(part.id),
        name: part.name,
        price: part.price?.toString() ?? null,
        brand: {
          id: part.part_brands.id,
          name: part.part_brands.name,
          logoUrl: part.part_brands.logo_url
        },
        images: part.part_images.map((img) => ({
          image: img.image,
          thumb: img.thumb
        })),
        properties: part.part_properties.map((prop) => ({
          key: prop.key,
          value: prop.value
        })),
        eans: part.part_eans.map((ean) => ean.code)
      }))

      console.log(
        `[CACHED] Parts query took ${(performance.now() - start).toFixed(
          0
        )}ms for ${result.length} parts`
      )

      return {
        parts: result,
        total,
        totalPages: Math.ceil(total / limit)
      }
    },
    ['cached-parts-for-category'],
    { revalidate: 300 } // Cache for 5 minutes
  )(categoryUrlKey, page, limit)

/**
 * Get cached parts for a vehicle-specific category page
 * Caches vehicle+category combinations for 5 minutes
 */
export const getCachedPartsForVehicle = async (
  vehicleTypeId: number,
  categoryUrlKey: string,
  page: number = 1,
  limit: number = 48
) =>
  await unstable_cache(
    async (
      vehicleTypeId: number,
      categoryUrlKey: string,
      page: number = 1,
      limit: number = 48
    ): Promise<{
      parts: CachedPartWithDetails[]
      total: number
      totalPages: number
    }> => {
      // Get tecdocId from variant
      const tecdocId = await getVariantTecdocId(vehicleTypeId)
      if (!tecdocId) {
        return { parts: [], total: 0, totalPages: 0 }
      }

      // Get category searchId
      const categorySearchId = await getCategorySearchId(categoryUrlKey)

      // Get part IDs for this vehicle
      const vehiclePartIds = await getVehiclePartIds(tecdocId)
      if (vehiclePartIds.length === 0) {
        return { parts: [], total: 0, totalPages: 0 }
      }

      // Fetch parts with category filter
      return fetchPartsByIds(vehiclePartIds, categorySearchId, page, limit)
    },
    ['cached-parts-for-vehicle'],
    { revalidate: 300 } // Cache for 5 minutes
  )(vehicleTypeId, categoryUrlKey, page, limit)
