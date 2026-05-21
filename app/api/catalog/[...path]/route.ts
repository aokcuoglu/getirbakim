import { NextRequest, NextResponse } from 'next/server'
import { getCategoryProducts } from '@/lib/actions/getCategoryProducts'

export async function GET(request: NextRequest) {
  const { pathname } = new URL(request.url)
  const segments = pathname.split('/').filter(Boolean)
  const slugIndex = segments.findIndex((s) => s === 'catalog')
  const categorySlug = slugIndex >= 0 ? segments[slugIndex + 1] : null

  if (!categorySlug) {
    return NextResponse.json(
      {
        error: {
          code: 'MISSING_SLUG',
          message:
            'A category slug is required in the path. Use /api/category-products?slug=<slug> for category-based product queries or /api/search for search queries.'
        }
      },
      { status: 400 }
    )
  }

  const t0 = performance.now()

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10) || 1
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '24', 10)), 48)
    const sortParam = searchParams.get('sort')
    const validSorts = ['popularity', 'price-asc', 'price-desc', 'name'] as const
    const sort = validSorts.includes(sortParam as typeof validSorts[number])
      ? (sortParam as typeof validSorts[number])
      : undefined

    const brandsParam = searchParams.get('brands')
    const stockParam = searchParams.get('stock')

    const brands = brandsParam
      ? brandsParam.split('|').map((b) => b.trim()).filter(Boolean)
      : []

    const stockStatuses = stockParam
      ? stockParam
          .split('|')
          .filter((s): s is 'in-stock' | 'on-order' => s === 'in-stock' || s === 'on-order')
      : []

    const minPrice = searchParams.get('minPrice')
    const maxPrice = searchParams.get('maxPrice')
    const vehicleIdParam = searchParams.get('vehicleId')

    const result = await getCategoryProducts({
      locale: searchParams.get('locale') || 'tr',
      slug: categorySlug,
      page,
      limit,
      sort,
      brands,
      stockStatuses,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      vehicleId: vehicleIdParam ? Number(vehicleIdParam) || null : null
    })

    const durationMs = Number((performance.now() - t0).toFixed(2))

    if (result.dataSource === 'category-not-found') {
      console.error(
        `[api/catalog] route=/api/catalog category=${categorySlug} source=category-not-found durationMs=${durationMs} error=Category not found`
      )
      return NextResponse.json(
        {
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: `Category not found for slug: ${categorySlug}`
          }
        },
        { status: 404 }
      )
    }

    console.log(
      `[api/catalog] route=/api/catalog category=${categorySlug} source=${result.dataSource} durationMs=${durationMs} products=${result.products.length} totalHits=${result.totalHits} totalEstimate=${result.totalEstimate} fallbackReason=${result.fallbackReason ?? 'none'}`
    )

    return NextResponse.json(
      {
        source: 'catalog-compat',
        originalEndpoint: '/api/category-products',
        category: categorySlug,
        products: result.products,
        hits: result.hits,
        page: result.page,
        limit: result.limit,
        hasMore: result.hasMore,
        totalHits: result.totalHits,
        totalEstimate: result.totalEstimate,
        facetDistribution: result.facetDistribution,
        brandFacetDistribution: result.brandFacetDistribution,
        stockFacetDistribution: result.stockFacetDistribution,
        dataSource: result.dataSource,
        durationMs: result.durationMs,
        cached: result.cached ?? false,
        liveFallbackUsed: result.liveFallbackUsed,
        fallbackReason: result.fallbackReason,
        purchasableCount: result.purchasableCount,
        outOfStockCount: result.outOfStockCount,
        requestPriceCount: result.requestPriceCount,
        verifyFitmentCount: result.verifyFitmentCount
      },
      {
        status: 200,
        headers: {
          'X-Compat-Endpoint': 'true',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=180'
        }
      }
    )
  } catch (error) {
    const durationMs = Number((performance.now() - t0).toFixed(2))
    console.error(
      `[api/catalog] route=/api/catalog category=${categorySlug} source=error durationMs=${durationMs} error=${error instanceof Error ? error.message : String(error)}`
    )
    return NextResponse.json(
      {
        error: {
          code: 'UPSTREAM_ERROR',
          message: error instanceof Error ? error.message : 'Internal error'
        }
      },
      { status: 502 }
    )
  }
}