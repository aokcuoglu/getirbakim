import 'server-only'
import { searchV0Catalog } from '@/lib/v0/search/v0-search-meili'

type V0SearchFilters = {
  brands?: string[]
  categories?: string[]
  minPrice?: number
  maxPrice?: number
}

export type V0SearchApiPayload = {
  query: string
  filters?: V0SearchFilters
  page?: number
  limit?: number
  sort?: string
  multiSearch?: boolean
}

export async function buildV0SearchApiResponse(body: V0SearchApiPayload) {
  const {
    query = '',
    filters = {},
    page = 1,
    limit = 24,
    sort,
    multiSearch = false
  } = body

  const result = await searchV0Catalog({
    query,
    page,
    limit: Math.min(limit, 60),
    brandNames: filters.brands,
    sort
  })

  const mainResult = {
    hits: result.hits,
    estimatedTotalHits: result.totalProducts,
    facetDistribution: {} as Record<string, Record<string, number>>,
    processingTimeMs: result.durationMs,
    query
  }

  const brandFacetResult = {
    hits: [] as typeof result.hits,
    estimatedTotalHits: 0,
    facetDistribution: { brandName: result.brandFacet },
    processingTimeMs: result.durationMs,
    query
  }

  const categoryFacetResult = {
    hits: [] as typeof result.hits,
    estimatedTotalHits: 0,
    facetDistribution: { categoryName: {} as Record<string, number> },
    processingTimeMs: 0,
    query
  }

  const payload = multiSearch
    ? {
        results: [mainResult, brandFacetResult, categoryFacetResult],
        cached: false,
        source: result.source,
        degraded: result.source === 'v0_postgres'
      }
    : {
        hits: result.hits,
        totalHits: result.totalProducts,
        facetDistribution: { brandName: result.brandFacet },
        processingTimeMs: result.durationMs,
        query,
        cached: false,
        source: result.source,
        degraded: result.source === 'v0_postgres'
      }

  return payload
}
