import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCategorySearchIdFromUrlKey } from '@/lib/actions/getPartCategories'
import { z } from 'zod'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

// In-memory caches for fast lookups
const categoryCache = new Map<string, number | null>()
const countCache = new Map<string, { count: number; timestamp: number }>()
const CACHE_TTL = 60 * 1000 // 1 minute cache for counts

const partsQuerySchema = z.object({
  category: z.string().min(1),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(120).default(24),
  brands: z.string().optional()
})

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:parts',
    limit: 240,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const startTime = Date.now()

  try {
    const queryCandidate = {
      category: request.nextUrl.searchParams.get('category'),
      page: request.nextUrl.searchParams.get('page') ?? '1',
      limit: request.nextUrl.searchParams.get('limit') ?? '24',
      brands: request.nextUrl.searchParams.get('brands') ?? undefined
    }
    const parsedQuery = partsQuerySchema.safeParse(queryCandidate)
    if (!parsedQuery.success) {
      return errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid query parameters.',
        details: parsedQuery.error.flatten(),
        context
      })
    }

    const categoryUrlKey = parsedQuery.data.category
    const page = parsedQuery.data.page
    const limit = parsedQuery.data.limit
    const brandNamesParam = parsedQuery.data.brands
    const brandNames = brandNamesParam?.split(',').filter(Boolean) || []

    // Get category searchId (cached)
    let categorySearchId = categoryCache.get(categoryUrlKey)

    if (categorySearchId === undefined) {
      categorySearchId = await getCategorySearchIdFromUrlKey(categoryUrlKey)
      categoryCache.set(categoryUrlKey, categorySearchId)
    }

    if (!categorySearchId) {
      return successResponse(
        {
          parts: [],
          total: 0,
          totalPages: 0,
          queryTime: Date.now() - startTime
        },
        context
      )
    }

    // Build cache key for count
    const countCacheKey = `${categorySearchId}:${brandNames.sort().join(',')}`

    // Handle brand filtering
    let brandIds: number[] = []
    if (brandNames.length > 0) {
      const matchedBrands = await db.part_brands.findMany({
        where: { name: { in: brandNames } },
        select: { id: true }
      })
      brandIds = matchedBrands.map((b) => b.id)
    }

    // Build where condition
    const whereCondition: {
      category_id: number
      brand_id?: { in: number[] }
    } = { category_id: categorySearchId }

    if (brandIds.length > 0) {
      whereCondition.brand_id = { in: brandIds }
    }

    const offset = (page - 1) * limit

    // Check count cache first
    let total: number
    const cachedCount = countCache.get(countCacheKey)

    if (cachedCount && Date.now() - cachedCount.timestamp < CACHE_TTL) {
      total = cachedCount.count
    } else {
      // Only fetch count if not cached
      total = await db.parts.count({ where: whereCondition })
      countCache.set(countCacheKey, { count: total, timestamp: Date.now() })
    }

    const totalPages = Math.ceil(total / limit)

    // OPTIMIZED: Query with included relations
    const fetchedParts = await db.parts.findMany({
      where: whereCondition,
      take: limit,
      skip: offset,
      include: {
        part_brands: {
          select: {
            id: true,
            name: true,
            logo_url: true
          }
        }
      }
    })

    // Transform to response format (no images for speed - can be lazy loaded)
    const transformedParts = fetchedParts.map((part) => ({
      id: Number(part.id),
      name: part.name,
      price: part.price?.toString() ?? null,
      brand: {
        id: part.part_brands.id,
        name: part.part_brands.name,
        logoUrl: part.part_brands.logo_url
      },
      images: [], // Skip for now - lazy load on client
      properties: [],
      eans: []
    }))

    const queryTime = Date.now() - startTime

    return successResponse(
      {
        parts: transformedParts,
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
        queryTime
      },
      context
    )
  } catch (error) {
    console.error('Error fetching parts:', error)
    return errorResponse({
      status: 500,
      code: 'PARTS_FETCH_FAILED',
      message: 'Internal server error',
      context
    })
  }
}
