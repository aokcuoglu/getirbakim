import crypto from 'crypto'
import { getCategoryByUrlKey, type PartCategory } from '@/lib/actions/getPartCategories'
import { getCatalogArticles, type ArticlesRequestBody } from '@/lib/actions/getCatalogArticles'
import { isMeiliEnabled, getMeiliClient, getProductsIndexName } from '@/lib/search/meilisearch-client'
import { isMeiliUnavailableError } from '@/lib/meilisearch'
import { searchCategoryProductsWithMeili, searchCategoryByNameFallback } from '@/lib/search/category-products-meili'
import { getFromCache, setCache } from '@/lib/redis'
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

type MeiliCacheEntry = {
  products: SearchHit[]
  page: number
  limit: number
  hasMore: boolean
  totalEstimate: number
  brandFacetDistribution: Record<string, number>
  stockFacetDistribution: { 'in-stock': number; 'on-order': number }
  dataSource: string
  durationMs: number
  purchasableCount: number
  requestPriceCount: number
  verifyFitmentCount: number
  outOfStockCount: number
}

function buildMeiliCacheKey(
  slug: string,
  page: number,
  limit: number,
  brands: string[],
  stockStatuses: string[],
  sort: string,
  minPrice?: number,
  maxPrice?: number
): string {
  const payload = {
    slug,
    page,
    limit,
    brands: [...brands].sort(),
    stockStatuses: [...stockStatuses].sort(),
    sort,
    minPrice,
    maxPrice
  }
  return `meili:category-products:v1:${crypto.createHash('md5').update(JSON.stringify(payload)).digest('hex')}`
}

const MEILI_CATEGORY_CACHE_TTL = 120

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

  const overallStart = performance.now()
  let fallbackReason: string | undefined

  const category = await getCategoryByUrlKey(slug)
  if (!category?.urlKey) {
    return {
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
      dataSource: 'category-not-found',
      durationMs: 0,
      liveFallbackUsed: false,
      purchasableCount: 0,
      requestPriceCount: 0,
      verifyFitmentCount: 0,
      outOfStockCount: 0
    }
  }

  if (!category.isLeaf) {
    return {
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
      dataSource: 'non-leaf-category',
      durationMs: 0,
      liveFallbackUsed: false,
      purchasableCount: 0,
      requestPriceCount: 0,
      verifyFitmentCount: 0,
      outOfStockCount: 0
    }
  }

  const safeLimit = Math.min(Math.max(1, limit), 48)
  const safePage = Math.max(1, page)

  const expandedSearchIds = collectDescendantIds(category)

  if (isMeiliEnabled() && !vehicleId) {
    const meiliCacheKey = buildMeiliCacheKey(
      category.urlKey,
      safePage,
      safeLimit,
      brands,
      stockStatuses,
      sort ?? 'popularity',
      Number.isFinite(minPrice as number) ? minPrice : undefined,
      Number.isFinite(maxPrice as number) ? maxPrice : undefined
    )

    try {
      const cachedMeili = await getFromCache<MeiliCacheEntry>(meiliCacheKey)
      if (cachedMeili && cachedMeili.products && Array.isArray(cachedMeili.products)) {
        const counts = countAvailabilityStatuses(cachedMeili.products)
        const facetDistribution: Record<string, Record<string, number>> = {
          brandName: cachedMeili.brandFacetDistribution,
          ...(typeof cachedMeili.stockFacetDistribution === 'object' && cachedMeili.stockFacetDistribution !== null
            ? { stockStatus: cachedMeili.stockFacetDistribution as Record<string, number> }
            : {})
        }
        const totalDurationMs = Number((performance.now() - overallStart).toFixed(2))
        console.log(
          `[getCategoryProducts] route=category-products category=${slug} source=meilisearch-category-products-cached durationMs=${totalDurationMs} productCount=${cachedMeili.products.length} totalHits=${cachedMeili.totalEstimate} fallbackReason=none`
        )
        return {
          products: cachedMeili.products,
          hits: cachedMeili.products,
          page: cachedMeili.page,
          limit: cachedMeili.limit,
          hasMore: cachedMeili.hasMore,
          totalHits: cachedMeili.totalEstimate,
          totalEstimate: cachedMeili.totalEstimate,
          facetDistribution,
          brandFacetDistribution: cachedMeili.brandFacetDistribution,
          stockFacetDistribution: cachedMeili.stockFacetDistribution,
          dataSource: cachedMeili.dataSource,
          durationMs: totalDurationMs,
          cached: true,
          liveFallbackUsed: false,
          fallbackReason: undefined,
          ...counts
        }
      }

      const meiliStart = performance.now()
      const client = getMeiliClient()
      const indexName = getProductsIndexName()

      const meiliResult = await searchCategoryProductsWithMeili(client, indexName, {
        locale,
        categorySlug: category.urlKey,
        categoryId: category.id,
        searchIds: expandedSearchIds,
        page: safePage,
        limit: safeLimit,
        brands,
        stockStatuses,
        sort,
        minPrice: Number.isFinite(minPrice as number) ? minPrice : undefined,
        maxPrice: Number.isFinite(maxPrice as number) ? maxPrice : undefined
      })
      const meiliDurationMs = Number((performance.now() - meiliStart).toFixed(2))

      if (meiliResult.products.length > 0 || meiliResult.totalEstimate > 0) {
        const counts = countAvailabilityStatuses(meiliResult.products)
        const facetDistribution: Record<string, Record<string, number>> = {
          brandName: meiliResult.brandFacetDistribution,
          ...(typeof meiliResult.stockFacetDistribution === 'object' && meiliResult.stockFacetDistribution !== null
            ? { stockStatus: meiliResult.stockFacetDistribution as Record<string, number> }
            : {})
        }

        const cacheEntry: MeiliCacheEntry = {
          products: meiliResult.products,
          page: meiliResult.page,
          limit: meiliResult.limit,
          hasMore: meiliResult.hasMore,
          totalEstimate: meiliResult.totalEstimate,
          brandFacetDistribution: meiliResult.brandFacetDistribution,
          stockFacetDistribution: meiliResult.stockFacetDistribution,
          dataSource: meiliResult.dataSource,
          durationMs: meiliResult.durationMs,
          ...counts
        }
        await setCache(meiliCacheKey, cacheEntry, MEILI_CATEGORY_CACHE_TTL)

        const totalDurationMs = Number((performance.now() - overallStart).toFixed(2))
        console.log(
          `[getCategoryProducts] route=category-products category=${slug} source=meilisearch-category-products meiliDurationMs=${meiliDurationMs} totalDurationMs=${totalDurationMs} productCount=${meiliResult.products.length} totalHits=${meiliResult.totalEstimate} fallbackReason=none`
        )

        return {
          products: meiliResult.products,
          hits: meiliResult.products,
          page: meiliResult.page,
          limit: meiliResult.limit,
          hasMore: meiliResult.hasMore,
          totalHits: meiliResult.totalEstimate,
          totalEstimate: meiliResult.totalEstimate,
          facetDistribution,
          brandFacetDistribution: meiliResult.brandFacetDistribution,
          stockFacetDistribution: meiliResult.stockFacetDistribution,
          dataSource: meiliResult.dataSource,
          durationMs: meiliResult.durationMs,
          cached: false,
          liveFallbackUsed: false,
          fallbackReason: undefined,
          ...counts
        }
      }

      fallbackReason = 'meilisearch-empty-result'
      console.warn(
        `[getCategoryProducts] route=category-products category=${slug} fallbackReason=meilisearch-empty-result meiliDurationMs=${meiliDurationMs} productCount=0 totalEstimate=${meiliResult.totalEstimate}`
      )

      if (category.name) {
        try {
          const nameFallbackStart = performance.now()
          const nameFallbackResult = await searchCategoryByNameFallback(client, indexName, {
            locale,
            categorySlug: category.urlKey,
            categoryId: category.id,
            searchIds: expandedSearchIds,
            categoryName: category.name,
            page: safePage,
            limit: safeLimit,
            brands,
            stockStatuses,
            sort,
            minPrice: Number.isFinite(minPrice as number) ? minPrice : undefined,
            maxPrice: Number.isFinite(maxPrice as number) ? maxPrice : undefined
          })
          const nameFallbackMs = Number((performance.now() - nameFallbackStart).toFixed(2))

          if (nameFallbackResult.products.length > 0 || nameFallbackResult.totalEstimate > 0) {
            const counts = countAvailabilityStatuses(nameFallbackResult.products)
            const facetDistribution: Record<string, Record<string, number>> = {
              brandName: nameFallbackResult.brandFacetDistribution,
              ...(typeof nameFallbackResult.stockFacetDistribution === 'object' && nameFallbackResult.stockFacetDistribution !== null
                ? { stockStatus: nameFallbackResult.stockFacetDistribution as Record<string, number> }
                : {})
            }

            const cacheEntry: MeiliCacheEntry = {
              products: nameFallbackResult.products,
              page: nameFallbackResult.page,
              limit: nameFallbackResult.limit,
              hasMore: nameFallbackResult.hasMore,
              totalEstimate: nameFallbackResult.totalEstimate,
              brandFacetDistribution: nameFallbackResult.brandFacetDistribution,
              stockFacetDistribution: nameFallbackResult.stockFacetDistribution,
              dataSource: nameFallbackResult.dataSource,
              durationMs: nameFallbackResult.durationMs,
              ...counts
            }
            await setCache(meiliCacheKey, cacheEntry, MEILI_CATEGORY_CACHE_TTL)

            const totalDurationMs = Number((performance.now() - overallStart).toFixed(2))
            console.log(
              `[getCategoryProducts] route=category-products category=${slug} source=meilisearch-category-name-fallback meiliDurationMs=${meiliDurationMs} nameFallbackMs=${nameFallbackMs} totalDurationMs=${totalDurationMs} productCount=${nameFallbackResult.products.length} totalHits=${nameFallbackResult.totalEstimate} fallbackReason=none`
            )

            return {
              products: nameFallbackResult.products,
              hits: nameFallbackResult.products,
              page: nameFallbackResult.page,
              limit: nameFallbackResult.limit,
              hasMore: nameFallbackResult.hasMore,
              totalHits: nameFallbackResult.totalEstimate,
              totalEstimate: nameFallbackResult.totalEstimate,
              facetDistribution,
              brandFacetDistribution: nameFallbackResult.brandFacetDistribution,
              stockFacetDistribution: nameFallbackResult.stockFacetDistribution,
              dataSource: nameFallbackResult.dataSource,
              durationMs: totalDurationMs,
              cached: false,
              liveFallbackUsed: false,
              fallbackReason: undefined,
              ...counts
            }
          }

          console.warn(
            `[getCategoryProducts] route=category-products category=${slug} nameFallbackMs=${nameFallbackMs} productCount=0 totalEstimate=${nameFallbackResult.totalEstimate} falling back to Prisma`
          )
        } catch (nameFallbackError) {
          console.warn(
            `[getCategoryProducts] route=category-products category=${slug} name-fallback-error error=${nameFallbackError instanceof Error ? nameFallbackError.message : String(nameFallbackError)}`
          )
        }
      }
    } catch (error) {
      if (isMeiliUnavailableError(error)) {
        fallbackReason = 'meilisearch-unavailable'
        console.warn(
          `[getCategoryProducts] route=category-products category=${slug} fallbackReason=meilisearch-unavailable error=Meilisearch service unreachable`
        )
      } else {
        fallbackReason = 'meilisearch-error'
        console.error(
          `[getCategoryProducts] route=category-products category=${slug} fallbackReason=meilisearch-error error=${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  } else if (!isMeiliEnabled()) {
    fallbackReason = 'meilisearch-disabled'
  } else if (vehicleId) {
    fallbackReason = 'vehicle-filter-required'
  }

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
      `[getCategoryProducts] route=category-products category=${slug} source=${result.source} prismaDurationMs=${prismaDurationMs} totalDurationMs=${totalDurationMs} productCount=${result.hits.length} totalHits=${result.totalHits ?? 0} fallbackReason=${fallbackReason ?? 'none'}`
    )
  } else {
    console.log(
      `[getCategoryProducts] route=category-products category=${slug} source=${result.source} prismaDurationMs=${prismaDurationMs} totalDurationMs=${totalDurationMs} productCount=${result.hits.length} totalHits=${result.totalHits ?? 0} fallbackReason=${fallbackReason ?? 'none'}`
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
    liveFallbackUsed: result.source.includes('fallback'),
    fallbackReason,
    ...counts
  }
}