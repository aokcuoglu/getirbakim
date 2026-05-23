import { NextRequest, NextResponse } from 'next/server'
import {
  buildCategoryPagePayload,
  resolveDefaultCategorySlug,
  type CategoryRouteSearchParams
} from '@/app/[locale]/_lib/category-page-data'

function parseHrefToCategoryRequest(href: string): {
  locale: string
  categorySlug: string
  searchParams: CategoryRouteSearchParams
} | null {
  const parsed = new URL(href, 'http://localhost')
  const segments = parsed.pathname.split('/').filter(Boolean)

  const locale = segments[0]
  if (locale !== 'tr' && locale !== 'en') {
    return null
  }

  const firstSegment = segments[1]
  if (!firstSegment) {
    return null
  }

  const searchParams: CategoryRouteSearchParams = {}
  parsed.searchParams.forEach((value, key) => {
    if (searchParams[key] === undefined) {
      searchParams[key] = value
      return
    }

    const existing = searchParams[key]
    if (Array.isArray(existing)) {
      existing.push(value)
      searchParams[key] = existing
      return
    }

    searchParams[key] = [existing, value]
  })

  if (firstSegment === 'catalog') {
    const cat = parsed.searchParams.get('cat')
    if (!cat) {
      return null
    }

    return {
      locale,
      categorySlug: cat,
      searchParams
    }
  }

  return {
    locale,
    categorySlug: firstSegment,
    searchParams
  }
}

const payloadCache = new Map<string, { payload: unknown; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')
  if (!href) {
    return NextResponse.json({ error: 'Missing href parameter.' }, { status: 400 })
  }

  const parsed = parseHrefToCategoryRequest(href)
  if (!parsed) {
    return NextResponse.json({ error: 'Unsupported category href.' }, { status: 400 })
  }

  const cacheKey = `${parsed.locale}:${parsed.categorySlug}:${JSON.stringify(parsed.searchParams)}`
  const cached = payloadCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json(cached.payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
        'X-Cache': 'HIT'
      }
    })
  }

  const categorySlug =
    parsed.categorySlug || (await resolveDefaultCategorySlug(parsed.locale))

  const payload = await buildCategoryPagePayload({
    locale: parsed.locale,
    categorySlug,
    searchParams: parsed.searchParams
  })

  if (!payload) {
    return NextResponse.json({ error: 'Category not found.' }, { status: 404 })
  }

  if (payloadCache.size > 500) {
    const now = Date.now()
    for (const [key, val] of payloadCache) {
      if (now >= val.expiresAt) {
        payloadCache.delete(key)
      }
    }
  }
  payloadCache.set(cacheKey, { payload, expiresAt: Date.now() + CACHE_TTL_MS })

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
      'X-Cache': 'MISS'
    }
  })
}