import { NextRequest } from 'next/server'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { getCategoryProducts } from '@/lib/actions/getCategoryProducts'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:category-products',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')

  if (!slug) {
    return errorResponse({
      status: 400,
      code: 'MISSING_SLUG',
      message: 'slug query parameter is required',
      context
    })
  }

  const pageParam = searchParams.get('page')
  const limitParam = searchParams.get('limit')
  const brandsParam = searchParams.get('brands')
  const stockParam = searchParams.get('stock')
  const sortParam = searchParams.get('sort')
  const minPriceParam = searchParams.get('minPrice')
  const maxPriceParam = searchParams.get('maxPrice')
  const vehicleIdParam = searchParams.get('vehicleId')
  const locale = searchParams.get('locale') || 'tr'

  const DELIMITER = '|'

  const brands = brandsParam
    ? brandsParam.split(DELIMITER).map((b) => b.trim()).filter(Boolean)
    : []

  const stockStatuses = stockParam
    ? stockParam
        .split(DELIMITER)
        .filter(
          (s): s is 'in-stock' | 'on-order' =>
            s === 'in-stock' || s === 'on-order'
        )
    : []

  const validSorts = ['popularity', 'price-asc', 'price-desc', 'name'] as const
  const sort: typeof validSorts[number] =
    validSorts.includes(sortParam as typeof validSorts[number])
      ? (sortParam as typeof validSorts[number])
      : 'popularity'

  const minPrice = minPriceParam ? Number(minPriceParam) : undefined
  const maxPrice = maxPriceParam ? Number(maxPriceParam) : undefined
  const vehicleId = vehicleIdParam ? Number(vehicleIdParam) || null : null

  try {
    const result = await getCategoryProducts({
      locale,
      slug,
      page: Math.max(1, parseInt(pageParam || '1', 10) || 1),
      limit: Math.min(Math.max(1, parseInt(limitParam || '24', 10)), 48),
      brands,
      stockStatuses,
      sort,
      minPrice: Number.isFinite(minPrice as number) ? minPrice : undefined,
      maxPrice: Number.isFinite(maxPrice as number) ? maxPrice : undefined,
      vehicleId
    })

    if (result.dataSource === 'category-not-found') {
      return errorResponse({
        status: 404,
        code: 'CATEGORY_NOT_FOUND',
        message: `Category not found for slug: ${slug}`,
        context
      })
    }

    if (result.durationMs > 1000) {
      console.warn(
        `[LEAF_PRODUCT_FETCH_BLOCKING] category-products slug=${slug} duration=${result.durationMs}ms source=${result.dataSource}`
      )
    }

    const response = successResponse(
      {
        products: result.products,
        page: result.page,
        limit: result.limit,
        hasMore: result.hasMore,
        totalEstimate: result.totalEstimate,
        brandFacetDistribution: result.brandFacetDistribution,
        stockFacetDistribution: result.stockFacetDistribution,
        dataSource: result.dataSource,
        durationMs: result.durationMs,
        cached: result.cached
      },
      context
    )

    if (result.cached) {
      response.headers.set('X-Cache', 'HIT')
    } else {
      response.headers.set('X-Cache', 'MISS')
    }

    return response
  } catch (error) {
    console.error(
      `[category-products] Error for slug=${slug}:`,
      error instanceof Error ? error.message : error
    )
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch category products',
      context
    })
  }
}