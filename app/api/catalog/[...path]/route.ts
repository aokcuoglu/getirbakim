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

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10) || 1
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '24', 10)), 48)
    const sortParam = searchParams.get('sort')
    const validSorts = ['popularity', 'price-asc', 'price-desc', 'name'] as const
    const sort = validSorts.includes(sortParam as typeof validSorts[number])
      ? (sortParam as typeof validSorts[number])
      : undefined

    const result = await getCategoryProducts({
      locale: searchParams.get('locale') || 'tr',
      slug: categorySlug,
      page,
      limit,
      sort
    })

    return NextResponse.json(
      {
        source: 'catalog-compat',
        originalEndpoint: '/api/category-products',
        category: categorySlug,
        note: 'This endpoint is a compatibility wrapper. For production use, prefer /api/category-products?slug=<slug> for category pages or /api/search for search.',
        ...result
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
    console.error('[/api/catalog] Error:', error)
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