import { getCategoryByUrlKey } from '@/lib/actions/getPartCategories'
import { getCatalogArticles, type ArticlesRequestBody } from '@/lib/actions/getCatalogArticles'
import { isMeiliEnabled, getMeiliClient, getProductsIndexName } from '@/lib/search/meilisearch-client'
import { isMeiliUnavailableError } from '@/lib/meilisearch'
import { searchCategoryProductsWithMeili } from '@/lib/search/category-products-meili'
import type { SearchHit } from '@/lib/types/search'

export type CategoryProductsInput = {
  locale?: string
  slug: string
  page?: number
  limit?: number
  brands?: string[]
  stockStatuses?: ('in-stock' | 'on-order')[]
  sort?: 'popularity' | 'price-asc' | 'price-desc' | 'name'
  minPrice?: number
  maxPrice?: number
  vehicleId?: number | null
}

export type CategoryProductsResult = {
  products: SearchHit[]
  page: number
  limit: number
  hasMore: boolean
  totalEstimate: number
  brandFacetDistribution: Record<string, number>
  stockFacetDistribution: Record<string, number> | { 'in-stock': number; 'on-order': number }
  dataSource: string
  durationMs: number
  cached?: boolean
}

export async function getCategoryProducts(input: CategoryProductsInput): Promise<CategoryProductsResult> {
  const {
    locale = 'tr',
    slug,
    page = 1,
    limit = 24,
    brands = [],
    stockStatuses = [],
    sort = 'popularity',
    minPrice,
    maxPrice,
    vehicleId = null
  } = input

  const category = await getCategoryByUrlKey(slug)
  if (!category?.urlKey) {
    return {
      products: [],
      page: 1,
      limit: 24,
      hasMore: false,
      totalEstimate: 0,
      brandFacetDistribution: {},
      stockFacetDistribution: { 'in-stock': 0, 'on-order': 0 },
      dataSource: 'category-not-found',
      durationMs: 0
    }
  }

  if (!category.isLeaf) {
    return {
      products: [],
      page: 1,
      limit: 24,
      hasMore: false,
      totalEstimate: 0,
      brandFacetDistribution: {},
      stockFacetDistribution: { 'in-stock': 0, 'on-order': 0 },
      dataSource: 'non-leaf-category',
      durationMs: 0
    }
  }

  const safeLimit = Math.min(Math.max(1, limit), 48)
  const safePage = Math.max(1, page)

  if (isMeiliEnabled() && !vehicleId) {
    try {
      const client = getMeiliClient()
      const indexName = getProductsIndexName()

      const meiliResult = await searchCategoryProductsWithMeili(client, indexName, {
        locale,
        categorySlug: category.urlKey,
        categoryId: category.id,
        page: safePage,
        limit: safeLimit,
        brands,
        stockStatuses,
        sort,
        minPrice: Number.isFinite(minPrice as number) ? minPrice : undefined,
        maxPrice: Number.isFinite(maxPrice as number) ? maxPrice : undefined
      })

      if (meiliResult.products.length > 0 || meiliResult.totalEstimate > 0) {
        return {
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
        }
      }
    } catch (error) {
      if (isMeiliUnavailableError(error)) {
        console.warn(
          `[getCategoryProducts] Meilisearch unavailable for slug=${slug}, falling back to Prisma`
        )
      } else {
        console.error(
          `[getCategoryProducts] Meilisearch error for slug=${slug}:`,
          error instanceof Error ? error.message : error
        )
      }
    }
  }

  const payload: ArticlesRequestBody = {
    categoryName: category.name,
    searchIds: category.searchIds,
    vehicleId: vehicleId ?? undefined,
    brands,
    stockStatuses,
    page: safePage,
    limit: safeLimit,
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

  if (durationMs > 1000) {
    console.warn(
      `[getCategoryProducts] slow query slug=${slug} duration=${durationMs}ms source=${result.source}`
    )
  }

  return {
    products: result.hits,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
    totalEstimate: result.totalHits ?? 0,
    brandFacetDistribution: result.brandFacetDistribution,
    stockFacetDistribution: result.stockFacetDistribution,
    dataSource: result.source,
    durationMs,
    cached: result.cached
  }
}