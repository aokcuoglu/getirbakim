import 'server-only'
import { getMeiliClient, isMeiliEnabled } from '@/lib/search/meilisearch-client'
import { getV0CatalogIndexName } from '@/lib/v0/search/v0-meilisearch-client'
import type { SearchHit } from '@/lib/types/search'
import type { V0DpmatchProductRow } from '@/lib/v0/types'
import type { V0BrandMatchRow } from '@/lib/v0/types'
import { mapDpmatchRowsToSearchHits } from '@/lib/v0/mapDpmatchToSearchHit'
import { searchV0CatalogSql } from '@/lib/v0/search/v0-search-sql'
import type { V0MeiliDocument } from '@/lib/v0/search/v0-search-document'

const V0_MEILI_SEARCH_TIMEOUT_MS = 2_000

async function withMeiliSearchTimeout<T>(
  promise: Promise<T>,
  timeoutMs = V0_MEILI_SEARCH_TIMEOUT_MS
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type V0MeiliSearchResult = {
  products: V0DpmatchProductRow[]
  brands: V0BrandMatchRow[]
  hits: SearchHit[]
  totalProducts: number
  brandFacet: Record<string, number>
  durationMs: number
  source: 'v0_meilisearch' | 'v0_postgres'
}

function buildBrandFilter(brandNames?: string[]): string | undefined {
  if (!brandNames || brandNames.length === 0) return undefined
  const quoted = brandNames.map((name) => `"${name.replace(/"/g, '\\"')}"`).join(', ')
  return `brandName IN [${quoted}]`
}

function meiliDocToBrandRow(doc: V0MeiliDocument): V0BrandMatchRow {
  return {
    matchId: doc.matchId,
    dbrandsId: null,
    dbrandsIds: [],
    ptbrandsId: null,
    brandName: doc.brandName,
    ptUrlKey: null,
    logoUrl: doc.brandLogo
  }
}

function isMeiliUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : ''

  return (
    message.includes('fetch failed') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('MeiliSearchCommunicationError') ||
    message.includes('index_not_found') ||
    message.includes('Index `') ||
    message.includes('Index not found') ||
    code === 'index_not_found'
  )
}

export async function searchV0CatalogMeili(options: {
  query: string
  page?: number
  limit?: number
  brandNames?: string[]
  sort?: string
}): Promise<V0MeiliSearchResult | null> {
  if (!isMeiliEnabled()) return null

  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(Math.max(1, options.limit ?? 24), 60)
  const offset = (page - 1) * limit
  const start = performance.now()

  try {
    const client = getMeiliClient()
    const index = client.index(getV0CatalogIndexName())

    const stats = await withMeiliSearchTimeout(index.getStats(), 800)
    if (stats && stats.numberOfDocuments === 0) {
      return null
    }

    const brandFilter = buildBrandFilter(options.brandNames)
    const productFilter = [
      'documentType = "v0_product"',
      brandFilter
    ]
      .filter(Boolean)
      .join(' AND ')

    const sort =
      options.sort === 'price-asc'
        ? ['price:asc']
        : options.sort === 'price-desc'
          ? ['price:desc']
          : options.sort === 'name'
            ? ['name:asc']
            : undefined

    const meiliSearches = Promise.all([
      index.search(options.query, {
        filter: productFilter,
        limit,
        offset,
        sort,
        attributesToRetrieve: ['*']
      }),
      options.query.trim() && page === 1
        ? index.search(options.query, {
            filter: 'documentType = "v0_brand"',
            limit: 5,
            attributesToRetrieve: ['*']
          })
        : Promise.resolve({ hits: [] as V0MeiliDocument[], estimatedTotalHits: 0 }),
      index.search(options.query, {
        filter: productFilter,
        limit: 0,
        facets: ['brandName']
      })
    ])

    const searchResults = await withMeiliSearchTimeout(meiliSearches)
    if (!searchResults) {
      return null
    }

    const [productSearch, brandSearch, facetSearch] = searchResults

    const productDocs = productSearch.hits as V0MeiliDocument[]
    const brandDocs = brandSearch.hits as V0MeiliDocument[]

    const sqlRows = productDocs.map(
      (doc): V0DpmatchProductRow => ({
        matchId: doc.matchId,
        dproductsId: null,
        ptproductsId: null,
        mappingStatus: 'APPROVED',
        matchMethod: null,
        normalized: null,
        dinamikStockCode: null,
        dinamikStockName: null,
        dinamikBrand: doc.brandName,
        dinamikPartNo: null,
        dinamikBarcode1: null,
        dinamikBarcode2: null,
        dinamikBarcode3: null,
        dinamikPrice: doc.price != null ? String(doc.price) : null,
        dinamikStockQty: doc.stockQty,
        ptTitle: doc.name,
        ptModel: null,
        ptRefNo: null,
        ptPrice: doc.price != null ? String(doc.price) : null,
        ptImageUrl: doc.image,
        ptUrl: null,
        ptManufacturerName: doc.brandName,
        brandLogoUrl: doc.brandLogo
      })
    )

    const brandFacet =
      (facetSearch.facetDistribution?.brandName as Record<string, number>) ??
      {}

    return {
      products: sqlRows,
      brands: brandDocs.map(meiliDocToBrandRow),
      hits: mapDpmatchRowsToSearchHits(sqlRows),
      totalProducts: productSearch.estimatedTotalHits ?? sqlRows.length,
      brandFacet,
      durationMs: Number((performance.now() - start).toFixed(2)),
      source: 'v0_meilisearch'
    }
  } catch (error) {
    if (isMeiliUnavailableError(error)) {
      return null
    }
    throw error
  }
}

export async function searchV0Catalog(options: {
  query: string
  page?: number
  limit?: number
  brandNames?: string[]
  sort?: string
}): Promise<V0MeiliSearchResult> {
  const meili = await searchV0CatalogMeili(options)
  if (meili && (meili.totalProducts > 0 || meili.brands.length > 0 || !options.query.trim())) {
    return meili
  }

  const sql = await searchV0CatalogSql(options)
  const brandFacet: Record<string, number> = {}
  for (const row of sql.products) {
    const name = row.dinamikBrand?.trim() || row.ptManufacturerName?.trim()
    if (name) {
      brandFacet[name] = (brandFacet[name] ?? 0) + 1
    }
  }

  return {
    products: sql.products,
    brands: sql.brands,
    hits: mapDpmatchRowsToSearchHits(sql.products),
    totalProducts: sql.totalProducts,
    brandFacet,
    durationMs: sql.durationMs,
    source: 'v0_postgres'
  }
}
