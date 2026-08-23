import { NextRequest, NextResponse } from 'next/server'
import { runCatalogSearch } from '@/lib/search/catalog-search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SearchRequestBody {
  query?: string
  filters?: {
    brands?: string[]
    categories?: string[]
    minPrice?: number
    maxPrice?: number
    vehicleIds?: number[]
  }
  page?: number
  limit?: number
  sort?: string
}

/**
 * Faceted storefront search over catalog.products.
 * Returns a multi-search payload the useSearch() hook expects:
 *   results[0] = main hits (all filters applied)
 *   results[1] = disjunctive brand facet (all filters except brand)
 *   results[2] = disjunctive category facet (all filters except category)
 */
export async function POST(request: NextRequest) {
  let body: SearchRequestBody
  try {
    body = (await request.json()) as SearchRequestBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const f = body.filters ?? {}
  try {
    const payload = await runCatalogSearch({
      query: body.query,
      brands: f.brands,
      categories: f.categories,
      minPrice: f.minPrice,
      maxPrice: f.maxPrice,
      vehicleIds: f.vehicleIds,
      page: body.page,
      limit: body.limit,
      sort: body.sort
    })
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
