import { NextRequest, NextResponse } from 'next/server'

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
    const baseUrl = new URL(request.url).origin
    const { searchParams } = new URL(request.url)
    const upstream = new URL(`${baseUrl}/api/search`)
    upstream.searchParams.set('q', '')
    upstream.searchParams.set('page', searchParams.get('page') || '1')
    upstream.searchParams.set('limit', searchParams.get('limit') || '24')

    const upstreamSort = searchParams.get('sort')
    if (upstreamSort) {
      upstream.searchParams.set('sort', upstreamSort)
    }

    const upstreamResp = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30000)
    })

    if (!upstreamResp.ok) {
      return NextResponse.json(
        {
          error: {
            code: 'UPSTREAM_ERROR',
            message: `Upstream search returned status ${upstreamResp.status}`
          }
        },
        { status: upstreamResp.status }
      )
    }

    const contentType = upstreamResp.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return NextResponse.json(
        {
          error: {
            code: 'UPSTREAM_ERROR',
            message: 'Upstream search returned non-JSON response'
          }
        },
        { status: 502 }
      )
    }

    const data = await upstreamResp.json()

    return NextResponse.json(
      {
        source: 'catalog-compat',
        originalEndpoint: '/api/category-products',
        category: categorySlug,
        note: 'This endpoint is a compatibility wrapper. For production use, prefer /api/category-products?slug=<slug> for category pages or /api/search for search.',
        ...data
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