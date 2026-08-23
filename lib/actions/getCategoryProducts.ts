import { getCategoryByUrlKey, type PartCategory } from '@/lib/actions/getPartCategories'
import { getCatalogArticles, type ArticlesRequestBody } from '@/lib/actions/getCatalogArticles'
import type { SearchHit } from '@/lib/types/search'

function collectDescendantIds(cat: PartCategory): number[] {
  const ids: number[] = [cat.id]
  if (cat.children && cat.children.length > 0) {
    for (const child of cat.children) {
      ids.push(...collectDescendantIds(child))
    }
  }
  return ids
}

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

function countAvailabilityStatuses(products: SearchHit[]) {
  let purchasableCount = 0
  let requestPriceCount = 0
  let verifyFitmentCount = 0
  let outOfStockCount = 0

  for (const product of products) {
    switch (product.availabilityStatus) {
      case 'PURCHASABLE':
        purchasableCount++
        break
      case 'REQUEST_PRICE':
        requestPriceCount++
        break
      case 'VERIFY_FITMENT':
        verifyFitmentCount++
        break
      case 'OUT_OF_STOCK':
        outOfStockCount++
        break
    }
  }

  return { purchasableCount, requestPriceCount, verifyFitmentCount, outOfStockCount }
}

export type CategoryProductsResult = {
  products: SearchHit[]
  hits: SearchHit[]
  page: number
  limit: number
  hasMore: boolean
  totalHits: number
  totalEstimate: number
  facetDistribution: Record<string, Record<string, number>>
  brandFacetDistribution: Record<string, number>
  stockFacetDistribution: Record<string, number> | { 'in-stock': number; 'on-order': number }
  dataSource: string
  durationMs: number
  cached?: boolean
  liveFallbackUsed: boolean
  purchasableCount: number
  requestPriceCount: number
  verifyFitmentCount: number
  outOfStockCount: number
  fallbackReason?: string
}

export async function getCategoryProducts(input: CategoryProductsInput): Promise<CategoryProductsResult> {
  const {
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

  const overallStart = performance.now()

  const empty = (
    dataSource: string
  ): CategoryProductsResult => ({
    products: [],
    hits: [],
    page: 1,
    limit: 24,
    hasMore: false,
    totalHits: 0,
    totalEstimate: 0,
    facetDistribution: {},
    brandFacetDistribution: {},
    stockFacetDistribution: { 'in-stock': 0, 'on-order': 0 },
    dataSource,
    durationMs: 0,
    liveFallbackUsed: false,
    purchasableCount: 0,
    requestPriceCount: 0,
    verifyFitmentCount: 0,
    outOfStockCount: 0
  })

  const category = await getCategoryByUrlKey(slug)
  if (!category?.urlKey) return empty('category-not-found')
  if (!category.isLeaf) return empty('non-leaf-category')

  const safeLimit = Math.min(Math.max(1, limit), 48)
  const safePage = Math.max(1, page)
  const expandedSearchIds = collectDescendantIds(category)

  const payload: ArticlesRequestBody = {
    categoryName: category.name,
    searchIds: expandedSearchIds,
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

  const prismaStart = performance.now()
  const result = await getCatalogArticles(payload)
  const prismaDurationMs = Number((performance.now() - prismaStart).toFixed(2))
  const totalDurationMs = Number((performance.now() - overallStart).toFixed(2))

  if (prismaDurationMs > 1000) {
    console.warn(
      `[getCategoryProducts] route=category-products category=${slug} source=${result.source} prismaDurationMs=${prismaDurationMs} totalDurationMs=${totalDurationMs} productCount=${result.hits.length} totalHits=${result.totalHits ?? 0}`
    )
  } else {
    console.log(
      `[getCategoryProducts] route=category-products category=${slug} source=${result.source} prismaDurationMs=${prismaDurationMs} totalDurationMs=${totalDurationMs} productCount=${result.hits.length} totalHits=${result.totalHits ?? 0}`
    )
  }

  const counts = countAvailabilityStatuses(result.hits)
  const facetDistribution: Record<string, Record<string, number>> = {
    brandName: result.brandFacetDistribution,
    ...(typeof result.stockFacetDistribution === 'object' && result.stockFacetDistribution !== null
      ? { stockStatus: result.stockFacetDistribution as Record<string, number> }
      : {})
  }

  return {
    products: result.hits,
    hits: result.hits,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
    totalHits: result.totalHits ?? 0,
    totalEstimate: result.totalHits ?? 0,
    facetDistribution,
    brandFacetDistribution: result.brandFacetDistribution,
    stockFacetDistribution: result.stockFacetDistribution,
    dataSource: result.source,
    durationMs: totalDurationMs,
    cached: result.cached,
    liveFallbackUsed: false,
    ...counts
  }
}
