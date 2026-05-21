import { MeiliSearch } from 'meilisearch'
import type { SearchDocument } from './search-document-builder'
import type {
  SearchDocumentAvailability
} from './search-document-types'
import type { SearchHit } from '@/lib/types/search'
import {
  resolveAvailabilityStatus,
  resolveCTA,
  resolveDetailUrl
} from './availability'
import { decimalToString } from '@/lib/pricing/public-pricing'

type CategoryProductsMeiliInput = {
  locale: string
  categorySlug?: string | null
  categoryId?: number | null
  searchIds?: number[]
  categoryName?: string | null
  page: number
  limit: number
  brands?: string[]
  stockStatuses?: ('in-stock' | 'on-order')[]
  sort?: string
  minPrice?: number
  maxPrice?: number
}

type CategoryProductsMeiliResult = {
  products: SearchHit[]
  page: number
  limit: number
  hasMore: boolean
  totalEstimate: number
  brandFacetDistribution: Record<string, number>
  stockFacetDistribution: { 'in-stock': number; 'on-order': number }
  dataSource: 'meilisearch-category-products' | 'meilisearch-category-name-fallback'
  durationMs: number
  cached: false
}

export async function searchCategoryProductsWithMeili(
  client: MeiliSearch,
  indexName: string,
  input: CategoryProductsMeiliInput
): Promise<CategoryProductsMeiliResult> {
  const startMs = performance.now()
  const index = client.index(indexName)

  const filterParts: string[] = []
  if (input.searchIds && input.searchIds.length > 0) {
    const idList = input.searchIds.join(', ')
    filterParts.push(`categoryId IN [${idList}]`)
  } else if (input.categorySlug) {
    filterParts.push(`categorySlug = "${input.categorySlug}"`)
  }
  filterParts.push(`documentType IN ["canonical_part", "supplier_offer", "orphan_supplier_product"]`)

  if (input.brands && input.brands.length > 0) {
    const brandFilter = input.brands.map((b) => `"${b}"`).join(', ')
    filterParts.push(`brand IN [${brandFilter}]`)
  }

  if (input.stockStatuses && input.stockStatuses.length > 0) {
    const stockConditions: string[] = []
    if (input.stockStatuses.includes('in-stock')) {
      stockConditions.push('hasStock = true')
    }
    if (input.stockStatuses.includes('on-order')) {
      stockConditions.push('hasStock = false')
    }
    if (stockConditions.length > 0) {
      filterParts.push(`(${stockConditions.join(' OR ')})`)
    }
  }

  if (input.minPrice !== undefined && Number.isFinite(input.minPrice)) {
    filterParts.push(`price >= ${input.minPrice}`)
  }
  if (input.maxPrice !== undefined && Number.isFinite(input.maxPrice)) {
    filterParts.push(`price <= ${input.maxPrice}`)
  }

  const meiliFilter = filterParts.join(' AND ')

  const meiliSort = getMeiliCategorySort(input.sort)

  const offset = (input.page - 1) * input.limit
  const safeLimit = Math.min(input.limit, 48)

  const searchResults = await index.search('', {
    filter: meiliFilter,
    limit: safeLimit,
    offset,
    sort: meiliSort.length > 0 ? meiliSort : undefined,
    facets: ['brand', 'availabilityStatus']
  })

  const durationMs = Number((performance.now() - startMs).toFixed(2))

  const hits = searchResults.hits as unknown as SearchDocument[]
  const products = mapMeiliDocsToSearchHits(hits)

  const brandFacetDistribution: Record<string, number> = {}
  if (searchResults.facetDistribution?.brand) {
    for (const [brandName, count] of Object.entries(searchResults.facetDistribution.brand)) {
      if (brandName && count > 0) {
        brandFacetDistribution[brandName] = count
      }
    }
  }

  let inStockCount = 0
  let onOrderCount = 0
  if (searchResults.facetDistribution?.availabilityStatus) {
    for (const [status, count] of Object.entries(searchResults.facetDistribution.availabilityStatus)) {
      if (status === 'PURCHASABLE' || status === 'OUT_OF_STOCK') {
        inStockCount += count
      } else {
        onOrderCount += count
      }
    }
  }

  const totalEstimate = searchResults.estimatedTotalHits ?? products.length
  const hasMore = totalEstimate > offset + safeLimit

  return {
    products,
    page: input.page,
    limit: safeLimit,
    hasMore,
    totalEstimate,
    brandFacetDistribution,
    stockFacetDistribution: { 'in-stock': inStockCount, 'on-order': onOrderCount },
    dataSource: 'meilisearch-category-products',
    durationMs,
    cached: false
  }
}

function mapMeiliDocsToSearchHits(docs: SearchDocument[]): SearchHit[] {
  return docs.map((doc): SearchHit => {
    const priceStr = doc.price !== null ? String(doc.price) : null
    const isPurchasable = doc.availabilityStatus === 'PURCHASABLE'
    const priceSource = doc.hasPrice ? 'real' : 'placeholder'
    const isPlaceholderPrice = !doc.hasPrice

    const availability: SearchDocumentAvailability = doc.availabilityStatus || 'REQUEST_PRICE'
    const cta = resolveCTA(availability)
    const detailUrl = doc.detailUrl || resolveDetailUrl({
      partId: doc.partId,
      supplierProductId: doc.supplierProductId ?? undefined
    })

    return {
      id: doc.id,
      name: doc.name || doc.title,
      articleLinkId: doc.articleLinkId,
      dedupeKey: doc.partId ? `part:${doc.partId}` : `sp:${doc.supplierProductId}`,
      variantCount: 1,
      price: priceStr,
      stockQty: doc.stockQty ?? 0,
      priceSource,
      isPlaceholderPrice,
      isPurchasable,
      inBasket: false,
      brandId: doc.brandId ?? 0,
      brandName: doc.brandName || doc.brand || '',
      brandLogo: doc.brandLogo ?? null,
      categoryId: doc.categoryId ?? 0,
      categoryName: doc.categoryName || null,
      categoryNameTr: doc.categoryNameTr || null,
      oemCodes: (doc.oemCodes || []).slice(0, 24),
      oemBrands: [],
      vehicleTypes: [],
      vehicleIds: [],
      vehicleNames: [],
      formattedCompatibility: [],
      searchableText: '',
      images: doc.imageUrl ? [{ image: doc.imageUrl, thumb: null }] : [],
      properties: [],
      createdAt: new Date(doc.updatedAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
      sourceType: doc.sourceType,
      resolvedPartId: doc.partId ?? doc.id,
      supplierProductId: doc.supplierProductId ?? null,
      providerCode: doc.providerCode ?? null,
      supplierSku: doc.supplierSku ?? null,
      matchType: doc.matchStatus === 'APPROVED' ? 'approved_oem_mapping' : undefined,
      canonicalKey: doc.partId ? `part:${doc.partId}` : `sp:${doc.supplierProductId}`,
      rankBucket: computeRankBucket(doc.rankScore),
      documentType: doc.documentType,
      canonicalPartId: doc.canonicalPartId ?? doc.partId ?? null,
      matchStatus: doc.matchStatus ?? 'APPROVED',
      hasSupplierOffer: doc.hasSupplierOffer ?? false,
      offerCount: doc.offerCount ?? 0,
      bestOfferProvider: doc.bestOfferProvider ?? null,
      availabilityStatus: doc.availabilityStatus,
      cta,
      detailUrl,
      crossReferences: doc.crossReferences ?? [],
      referenceNumbers: doc.referenceNumbers ?? [],
      vehicleBrandNames: doc.vehicleBrandNames ?? [],
      vehicleModelNames: doc.vehicleModelNames ?? [],
      fitmentCount: doc.fitmentCount ?? 0
    }
  })
}

function computeRankBucket(rankScore: number): number {
  if (rankScore >= 100) return 1
  if (rankScore >= 50) return 2
  if (rankScore >= 25) return 3
  return 4
}

function getMeiliCategorySort(sort?: string): string[] {
  switch (sort) {
    case 'price-asc':
      return ['price:asc', 'rankScore:desc']
    case 'price-desc':
      return ['price:desc', 'rankScore:desc']
    case 'name':
      return ['name:asc']
    case 'popularity':
      return ['rankScore:desc']
    default:
      return ['rankScore:desc']
  }
}

export async function searchCategoryByNameFallback(
  client: MeiliSearch,
  indexName: string,
  input: CategoryProductsMeiliInput & { categoryName: string }
): Promise<CategoryProductsMeiliResult> {
  const startMs = performance.now()
  const index = client.index(indexName)

  const filterParts: string[] = []
  filterParts.push(`documentType IN ["canonical_part", "supplier_offer", "orphan_supplier_product"]`)

  if (input.brands && input.brands.length > 0) {
    const brandFilter = input.brands.map((b) => `"${b}"`).join(', ')
    filterParts.push(`brand IN [${brandFilter}]`)
  }

  if (input.stockStatuses && input.stockStatuses.length > 0) {
    const stockConditions: string[] = []
    if (input.stockStatuses.includes('in-stock')) {
      stockConditions.push('hasStock = true')
    }
    if (input.stockStatuses.includes('on-order')) {
      stockConditions.push('hasStock = false')
    }
    if (stockConditions.length > 0) {
      filterParts.push(`(${stockConditions.join(' OR ')})`)
    }
  }

  if (input.minPrice !== undefined && Number.isFinite(input.minPrice)) {
    filterParts.push(`price >= ${input.minPrice}`)
  }
  if (input.maxPrice !== undefined && Number.isFinite(input.maxPrice)) {
    filterParts.push(`price <= ${input.maxPrice}`)
  }

  const meiliFilter = filterParts.join(' AND ')
  const meiliSort = getMeiliCategorySort(input.sort)
  const offset = (input.page - 1) * input.limit
  const safeLimit = Math.min(input.limit, 48)

  const searchResults = await index.search(input.categoryName, {
    filter: meiliFilter,
    limit: safeLimit,
    offset,
    sort: meiliSort.length > 0 ? meiliSort : undefined,
    facets: ['brand', 'availabilityStatus']
  })

  const durationMs = Number((performance.now() - startMs).toFixed(2))

  const hits = searchResults.hits as unknown as SearchDocument[]
  const products = mapMeiliDocsToSearchHits(hits)

  const brandFacetDistribution: Record<string, number> = {}
  if (searchResults.facetDistribution?.brand) {
    for (const [brandName, count] of Object.entries(searchResults.facetDistribution.brand)) {
      if (brandName && count > 0) {
        brandFacetDistribution[brandName] = count
      }
    }
  }

  let inStockCount = 0
  let onOrderCount = 0
  if (searchResults.facetDistribution?.availabilityStatus) {
    for (const [status, count] of Object.entries(searchResults.facetDistribution.availabilityStatus)) {
      if (status === 'PURCHASABLE' || status === 'OUT_OF_STOCK') {
        inStockCount += count
      } else {
        onOrderCount += count
      }
    }
  }

  const totalEstimate = searchResults.estimatedTotalHits ?? products.length
  const hasMore = totalEstimate > offset + safeLimit

  return {
    products,
    page: input.page,
    limit: safeLimit,
    hasMore,
    totalEstimate,
    brandFacetDistribution,
    stockFacetDistribution: { 'in-stock': inStockCount, 'on-order': onOrderCount },
    dataSource: 'meilisearch-category-name-fallback',
    durationMs,
    cached: false
  }
}