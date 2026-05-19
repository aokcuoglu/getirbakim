import { NextRequest } from 'next/server'
import { getCatalogArticles, type ArticlesRequestBody } from '@/lib/actions/getCatalogArticles'
import { getCategoryByUrlKey } from '@/lib/actions/getPartCategories'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { isMeiliEnabled, getMeiliClient, getProductsIndexName } from '@/lib/search/meilisearch-client'
import { isMeiliUnavailableError } from '@/lib/meilisearch'
import { searchCategoryProductsWithMeili } from '@/lib/search/category-products-meili'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:category-products',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const { searchParams } = new URL(request.url)
  const locale = searchParams.get('locale') || 'tr'
  const slug = searchParams.get('slug')
  const pageParam = searchParams.get('page')
  const limitParam = searchParams.get('limit')

  if (!slug) {
    return errorResponse({
      status: 400,
      code: 'MISSING_SLUG',
      message: 'slug query parameter is required',
      context
    })
  }

  const category = await getCategoryByUrlKey(slug)
  if (!category?.urlKey) {
    return errorResponse({
      status: 404,
      code: 'CATEGORY_NOT_FOUND',
      message: `Category not found for slug: ${slug}`,
      context
    })
  }

  if (!category.isLeaf) {
    return successResponse(
      {
        products: [],
        page: 1,
        limit: 24,
        hasMore: false,
        totalEstimate: 0,
        brandFacetDistribution: {},
        stockFacetDistribution: { 'in-stock': 0, 'on-order': 0 },
        dataSource: 'non-leaf-category',
        durationMs: 0
      },
      context
    )
  }

  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1)
  const parsedLimit = parseInt(limitParam || '24', 10)
  const limit = Math.min(Math.max(1, parsedLimit || 24), 48)

  const brandsParam = searchParams.get('brands')
  const stockParam = searchParams.get('stock')
  const sortParam = searchParams.get('sort')
  const minPriceParam = searchParams.get('minPrice')
  const maxPriceParam = searchParams.get('maxPrice')
  const vehicleIdParam = searchParams.get('vehicleId')

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

  if (isMeiliEnabled() && !vehicleId) {
    try {
      const client = getMeiliClient()
      const indexName = getProductsIndexName()

      const meiliResult = await searchCategoryProductsWithMeili(client, indexName, {
        locale,
        categorySlug: category.urlKey,
        categoryId: category.id,
        page,
        limit,
        brands,
        stockStatuses,
        sort,
        minPrice: Number.isFinite(minPrice as number) ? minPrice : undefined,
        maxPrice: Number.isFinite(maxPrice as number) ? maxPrice : undefined
      })

      if (meiliResult.products.length > 0 || meiliResult.totalEstimate > 0) {
        const response = successResponse(
          {
            products: meiliResult.products,
            page: meiliResult.page,
            limit: meiliResult.limit,
            hasMore: meiliResult.hasMore,
            totalEstimate: meiliResult.totalEstimate,
            brandFacetDistribution: meiliResult.brandFacetDistribution,
            stockFacetDistribution: meiliResult.stockFacetDistribution,
            dataSource: meiliResult.dataSource,
            durationMs: meiliResult.durationMs,
            cached: false
          },
          context
        )
        response.headers.set('X-Cache', 'MISS')
        return response
      }
    } catch (error) {
      if (isMeiliUnavailableError(error)) {
        console.warn(
          `[category-products] Meilisearch unavailable for slug=${slug}, falling back to Prisma`
        )
      } else {
        console.error(
          `[category-products] Meilisearch error for slug=${slug}:`,
          error instanceof Error ? error.message : error
        )
      }
    }
  }

  const payload: ArticlesRequestBody = {
    categoryName: category.name,
    searchIds: category.searchIds,
    vehicleId,
    brands,
    stockStatuses,
    page,
    limit,
    sort,
    minPrice: Number.isFinite(minPrice as number) ? minPrice : undefined,
    maxPrice: Number.isFinite(maxPrice as number) ? maxPrice : undefined,
    includePrice: true,
    includeHits: true,
    includeTotal: true,
    includeFacets: true
  }

  const startMs = performance.now()
  const result = await getCatalogArticles(payload)
  const durationMs = Number((performance.now() - startMs).toFixed(2))

  if (
    result.hits.length > 48 &&
    process.env.PERFORMANCE_LOGGING === 'true'
  ) {
    console.warn(
      `[LEAF_PRODUCT_COUNT_TOO_LARGE] category-products slug=${slug} hits=${result.hits.length} page=${page} limit=${limit} totalHits=${result.totalHits} source=${result.source}`
    )
  }

  if (durationMs > 1000) {
    console.warn(
      `[LEAF_PRODUCT_FETCH_BLOCKING] category-products slug=${slug} duration=${durationMs}ms source=${result.source}`
    )
  }

  const response = successResponse(
    {
      products: result.hits,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
      totalEstimate: result.totalHits,
      brandFacetDistribution: result.brandFacetDistribution,
      stockFacetDistribution: result.stockFacetDistribution,
      dataSource: result.source,
      durationMs,
      cached: result.cached
    },
    context
  )

  if (result.cached) {
    response.headers.set('X-Cache', 'HIT')
  } else {
    response.headers.set('X-Cache', 'MISS')
  }

  if (result.debugTimingsMs) {
    const timingParts = Object.entries(result.debugTimingsMs)
      .filter(([key]) => key !== 'total')
      .map(([key, val]) => `${key};dur=${val}`)

    if (result.debugTimingsMs.total) {
      timingParts.push(`total;dur=${result.debugTimingsMs.total}`)
    }

    if (timingParts.length > 0) {
      response.headers.set('Server-Timing', timingParts.join(','))
    }
  }

  return response
}