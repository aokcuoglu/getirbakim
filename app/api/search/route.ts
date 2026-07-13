import { NextRequest, NextResponse } from 'next/server'
import {
  getMeiliClient,
  getProductsIndexName,
  isMeiliEnabled
} from '@/lib/search/meilisearch-client'
import { isMeiliUnavailableError } from '@/lib/meilisearch'
import { mapMeiliDocsToSearchHits } from '@/lib/search/category-products-meili'
import type { SearchDocument } from '@/lib/search/search-document-builder'

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

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function baseFilters(body: SearchRequestBody): string[] {
  const parts: string[] = ['documentType = "canonical_part"']
  const f = body.filters ?? {}
  if (f.minPrice !== undefined && Number.isFinite(f.minPrice)) {
    parts.push(`price >= ${f.minPrice}`)
  }
  if (f.maxPrice !== undefined && Number.isFinite(f.maxPrice)) {
    parts.push(`price <= ${f.maxPrice}`)
  }
  return parts
}

function brandFilter(body: SearchRequestBody): string | null {
  const brands = body.filters?.brands ?? []
  if (brands.length === 0) return null
  return `brandName IN [${brands.map(quote).join(', ')}]`
}

function categoryFilter(body: SearchRequestBody): string | null {
  const categories = body.filters?.categories ?? []
  if (categories.length === 0) return null
  return `categoryName IN [${categories.map(quote).join(', ')}]`
}

function sortFor(sort?: string): string[] | undefined {
  switch (sort) {
    case 'price-asc':
      return ['price:asc', 'rankScore:desc']
    case 'price-desc':
      return ['price:desc', 'rankScore:desc']
    case 'name':
      return ['name:asc']
    default:
      return ['rankScore:desc']
  }
}

/**
 * Faceted storefront search over the catalog-sourced `products` index.
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

  const emptyPayload = {
    results: [
      { hits: [], estimatedTotalHits: 0 },
      { facetDistribution: { brandName: {} } },
      { facetDistribution: { categoryName: {} } }
    ]
  }

  if (!isMeiliEnabled()) {
    return NextResponse.json(emptyPayload)
  }

  const query = (body.query ?? '').trim()
  const page = Math.max(1, body.page ?? 1)
  const limit = Math.min(Math.max(1, body.limit ?? 24), 48)
  const offset = (page - 1) * limit
  const sort = sortFor(body.sort)

  const base = baseFilters(body)
  const bFilter = brandFilter(body)
  const cFilter = categoryFilter(body)

  const mainFilter = [...base, bFilter, cFilter].filter(Boolean).join(' AND ')
  const brandFacetFilter = [...base, cFilter].filter(Boolean).join(' AND ')
  const categoryFacetFilter = [...base, bFilter].filter(Boolean).join(' AND ')

  try {
    const index = getMeiliClient().index(getProductsIndexName())

    const [main, brandFacet, categoryFacet] = await Promise.all([
      index.search(query, { filter: mainFilter, limit, offset, sort }),
      index.search(query, {
        filter: brandFacetFilter,
        limit: 0,
        facets: ['brandName']
      }),
      index.search(query, {
        filter: categoryFacetFilter,
        limit: 0,
        facets: ['categoryName']
      })
    ])

    const hits = mapMeiliDocsToSearchHits(
      main.hits as unknown as SearchDocument[]
    )

    return NextResponse.json({
      results: [
        { hits, estimatedTotalHits: main.estimatedTotalHits ?? hits.length },
        { facetDistribution: { brandName: brandFacet.facetDistribution?.brandName ?? {} } },
        {
          facetDistribution: {
            categoryName: categoryFacet.facetDistribution?.categoryName ?? {}
          }
        }
      ]
    })
  } catch (error) {
    if (isMeiliUnavailableError(error)) {
      return NextResponse.json(emptyPayload)
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
