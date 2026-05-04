'use server'

import { db } from '@/lib/db'
import { unstable_cache } from 'next/cache'
import { getCategorySearchIdFromUrlKey } from './getPartCategories'
import {
  decimalToString,
  resolvePublicPriceAndPurchasability,
  resolveRealPriceExVat
} from '@/lib/pricing/public-pricing'
import { getCategoryMinRealPriceMap } from '@/lib/pricing/public-pricing-db'

export interface PartWithDetails {
  id: number
  name: string
  dedupeKey?: string
  variantCount?: number
  sourceType?: 'part' | 'supplier_product'
  resolvedPartId?: string
  supplierProductId?: number | null
  providerCode?: string | null
  supplierSku?: string | null
  matchType?: 'approved_oem_mapping' | 'manual_mapping' | 'derived_clone'
  canonicalKey?: string
  rankBucket?: number
  price: string | null
  priceSource: 'real' | 'placeholder'
  isPlaceholderPrice: boolean
  isPurchasable: boolean
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
  stock?: number
}

interface GetPartsParams {
  vehicleTypeId?: number // TecDoc ID from URL
  categoryUrlKey?: string // Category URL key
  brandNames?: string[] // Brand names to filter by
  page?: number
  limit?: number
}

interface GetPartsResult {
  parts: PartWithDetails[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * Cached function to get category searchId from urlKey
 * Cache for 1 hour to avoid repeated DB lookups
 */
const getCategorySearchId = unstable_cache(
  async (categoryUrlKey: string): Promise<number | null> => {
    return getCategorySearchIdFromUrlKey(categoryUrlKey)
  },
  ['category-search-id-v2'],
  { revalidate: 3600 } // 1 hour cache
)

/**
 * Cached function to get total parts count for a category
 * Cache for 1 hour - count rarely changes and is expensive to compute
 */
const getTotalPartsCount = unstable_cache(
  async (categorySearchId: number, brandIds?: number[]): Promise<number> => {
    const whereCondition: {
      category_id: number
      brand_id?: { in: number[] }
    } = { category_id: categorySearchId }

    if (brandIds && brandIds.length > 0) {
      whereCondition.brand_id = { in: brandIds }
    }

    const result = await db.parts.count({
      where: whereCondition
    })

    return result
  },
  ['parts-total-count'],
  { revalidate: 3600 } // 1 hour cache
)

/**
 * Fetch parts filtered by vehicle type and category
 * Uses part_vehicle_types junction table for vehicle filtering
 */
export async function getPartsForVehicle({
  vehicleTypeId,
  categoryUrlKey,
  brandNames,
  page = 1,
  limit = 24
}: GetPartsParams): Promise<GetPartsResult> {
  try {
    // Use cached category lookup
    let categorySearchId: number | null = null

    if (categoryUrlKey) {
      categorySearchId = await getCategorySearchId(categoryUrlKey)
    }

    // Build the query for parts
    let partIds: bigint[] = []

    if (vehicleTypeId) {
      // vehicleTypeId is the variant.id from URL, we need to get tecdocId from variants table
      const variant = await db.variants.findFirst({
        where: { id: vehicleTypeId }
      })

      if (variant?.tecdoc_id) {
        // Get part IDs that match the vehicle type using tecdocId
        const vehicleParts = await db.part_vehicle_types.findMany({
          where: { vehicle_type_id: variant.tecdoc_id },
          select: { part_id: true }
        })

        partIds = vehicleParts.map((p) => p.part_id)
      }
    }

    // If no vehicle type specified or no parts found, return empty
    if (vehicleTypeId && partIds.length === 0) {
      return {
        parts: [],
        total: 0,
        page,
        limit,
        totalPages: 0
      }
    }

    // Build where conditions
    const whereCondition: {
      category_id?: number
      id?: { in: bigint[] }
      brand_id?: { in: number[] }
    } = {}

    if (categoryUrlKey) {
      if (!categorySearchId) {
        return {
          parts: [],
          total: 0,
          page,
          limit,
          totalPages: 0
        }
      }
      whereCondition.category_id = categorySearchId
    }

    if (vehicleTypeId) {
      if (partIds.length === 0) {
        return {
          parts: [],
          total: 0,
          page,
          limit,
          totalPages: 0
        }
      }
      whereCondition.id = { in: partIds }
    }

    let brandIds: number[] = []
    if (brandNames && brandNames.length > 0) {
      // Find brand IDs for the given names
      const matchedBrands = await db.part_brands.findMany({
        where: { name: { in: brandNames } }
      })
      brandIds = matchedBrands.map((b) => b.id)
      if (brandIds.length > 0) {
        whereCondition.brand_id = { in: brandIds }
      } else {
        // Brands requested but none found in DB
        return {
          parts: [],
          total: 0,
          page,
          limit,
          totalPages: 0
        }
      }
    }

    // Calculate offset for pagination
    const offset = (page - 1) * limit

    // Fetch parts with pagination
    const queryStart = performance.now()
    const fetchedParts = await db.parts.findMany({
      where:
        Object.keys(whereCondition).length > 0 ? whereCondition : undefined,
      take: limit,
      skip: offset,
      include: {
        part_brands: true,
        part_images: true,
        part_properties: true,
        part_eans: true,
        part_pricing_inventory: {
          select: {
            supplier_price: true,
            computed_selling_price_ex_vat: true,
            supplier_stock_qty: true,
            reserved_stock_qty: true
          }
        },
        part_admin_overrides: {
          select: {
            lock_price: true,
            selling_price_override: true
          }
        }
      }
    })
    console.log(
      `[DB] Parts query took ${(performance.now() - queryStart).toFixed(
        0
      )}ms for ${fetchedParts.length} parts`
    )

    // Get real total count using cached query
    // Only use cache when no vehicle filter (category-only queries)
    let total = 0
    if (categorySearchId && !vehicleTypeId) {
      total = await getTotalPartsCount(
        categorySearchId,
        brandIds.length > 0 ? brandIds : undefined
      )
    } else {
      // Fallback for vehicle-filtered queries (less common)
      total =
        fetchedParts.length < limit
          ? fetchedParts.length + offset
          : (page + 1) * limit
    }

    // Transform to response format
    const categoryMinPriceMap = await getCategoryMinRealPriceMap(
      Array.from(new Set(fetchedParts.map((part) => part.category_id)))
    )

    const transformedParts: PartWithDetails[] = fetchedParts.map((part) => {
      const pricing = resolvePublicPriceAndPurchasability({
        realPriceExVat: resolveRealPriceExVat(part),
        categoryMinRealPriceExVat: categoryMinPriceMap.get(part.category_id),
        stockQty: part.part_pricing_inventory?.supplier_stock_qty ?? 0,
        reservedStockQty: part.part_pricing_inventory?.reserved_stock_qty ?? 0
      })

      return {
        id: Number(part.id),
        name: part.name,
        price: decimalToString(pricing.resolvedPriceExVat),
        priceSource: pricing.priceSource,
        isPlaceholderPrice: pricing.isPlaceholderPrice,
        isPurchasable: pricing.isPurchasable,
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
        eans: part.part_eans.map((ean) => ean.code),
        stock: pricing.stockQty
      }
    })

    return {
      parts: transformedParts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  } catch (error) {
    console.error('Error fetching parts:', error)
    return {
      parts: [],
      total: 0,
      page,
      limit,
      totalPages: 0
    }
  }
}
