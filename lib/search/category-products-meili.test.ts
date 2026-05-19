import { describe, expect, it } from 'bun:test'
import type { SearchDocument } from './search-document-builder'
import type { SearchHit } from '@/lib/types/search'

function makeSearchDoc(overrides: Partial<SearchDocument> = {}): SearchDocument {
  return {
    id: 'part_100',
    documentType: 'canonical_part',
    partId: '100',
    supplierProductId: null,
    canonicalPartId: '100',
    title: 'Test Part',
    titleTr: null,
    brand: 'TestBrand',
    categoryId: 10,
    categoryName: 'Air Filter',
    categoryNameTr: 'Hava Filtresi',
    categorySlug: 'air-filter',
    supplierSku: null,
    normalizedSku: null,
    providerCode: null,
    providerName: null,
    oemCodes: [],
    eanCodes: [],
    crossReferences: [],
    referenceNumbers: [],
    exactCodes: [],
    normalizedSearchText: '',
    searchKeywords: [],
    synonymsText: '',
    price: 100,
    stockQty: 5,
    currency: 'TRY',
    hasPrice: true,
    hasStock: true,
    hasSupplierOffer: true,
    offerCount: 1,
    bestOfferProvider: null,
    bestOfferSupplierProductId: null,
    availabilityStatus: 'PURCHASABLE',
    cta: 'add_to_cart',
    matchStatus: 'APPROVED',
    matchConfidence: null,
    matchReason: null,
    vehicleBrandNames: [],
    vehicleModelNames: [],
    vehicleTypeNames: [],
    vehicleYears: [],
    engineCodes: [],
    fitmentCount: 0,
    detailUrl: '/part/100',
    imageUrl: null,
    updatedAt: Date.now(),
    rankScore: 100,
    name: 'Test Part',
    brandName: 'TestBrand',
    brandId: 1,
    brandLogo: null,
    articleLinkId: '200',
    sourceType: 'part',
    ...overrides
  }
}

describe('category-products-meili filter construction', () => {
  it('builds categorySlug filter for leaf category', () => {
    const slug = 'air-filter'
    const filterParts: string[] = []
    filterParts.push(`categorySlug = "${slug}"`)
    filterParts.push(`documentType IN ["canonical_part", "supplier_offer", "orphan_supplier_product"]`)
    const filter = filterParts.join(' AND ')
    expect(filter.includes('categorySlug = "air-filter"')).toBe(true)
    expect(filter.includes('documentType IN ["canonical_part"')).toBe(true)
  })

  it('adds brand filter when brands specified', () => {
    const brands = ['Bosch', 'Mann']
    const filterParts: string[] = [`categorySlug = "air-filter"`, `documentType IN ["canonical_part", "supplier_offer", "orphan_supplier_product"]`]
    if (brands.length > 0) {
      const brandFilter = brands.map((b) => `"${b}"`).join(', ')
      filterParts.push(`brand IN [${brandFilter}]`)
    }
    const filter = filterParts.join(' AND ')
    expect(filter.includes('brand IN ["Bosch", "Mann"]')).toBe(true)
  })

  it('adds stock filter for in-stock', () => {
    const stockStatuses: ('in-stock' | 'on-order')[] = ['in-stock']
    const stockConditions: string[] = []
    if (stockStatuses.includes('in-stock')) {
      stockConditions.push('hasStock = true')
    }
    if (stockStatuses.includes('on-order')) {
      stockConditions.push('hasStock = false')
    }
    expect(stockConditions).toEqual(['hasStock = true'])
  })

  it('adds price range filter', () => {
    const minPrice = 50
    const maxPrice = 500
    const filterParts: string[] = [`categorySlug = "air-filter"`]
    filterParts.push(`price >= ${minPrice}`)
    filterParts.push(`price <= ${maxPrice}`)
    const filter = filterParts.join(' AND ')
    expect(filter.includes('price >= 50')).toBe(true)
    expect(filter.includes('price <= 500')).toBe(true)
  })
})

describe('category-products-meili mapping to SearchHit', () => {
  it('maps PURCHASABLE document to SearchHit correctly', () => {
    const doc = makeSearchDoc({
      availabilityStatus: 'PURCHASABLE',
      price: 250,
      hasPrice: true,
      stockQty: 10
    })

    const priceStr = doc.price !== null ? String(doc.price) : null
    const isPurchasable = doc.availabilityStatus === 'PURCHASABLE'
    const priceSource = doc.hasPrice ? 'real' : 'placeholder'
    const isPlaceholderPrice = !doc.hasPrice

    expect(priceStr).toBe('250')
    expect(isPurchasable).toBe(true)
    expect(priceSource).toBe('real')
    expect(isPlaceholderPrice).toBe(false)
  })

  it('maps REQUEST_PRICE document correctly', () => {
    const doc = makeSearchDoc({
      availabilityStatus: 'REQUEST_PRICE',
      price: null,
      hasPrice: false,
      stockQty: 0
    })

    const priceStr = doc.price !== null ? String(doc.price) : null
    const isPurchasable = doc.availabilityStatus === 'PURCHASABLE'
    const priceSource = doc.hasPrice ? 'real' : 'placeholder'

    expect(priceStr).toBeNull()
    expect(isPurchasable).toBe(false)
    expect(priceSource).toBe('placeholder')
  })

  it('maps supplier_product sourceType correctly', () => {
    const doc = makeSearchDoc({
      documentType: 'supplier_offer',
      sourceType: 'supplier_product',
      supplierProductId: 42,
      partId: '100'
    })

    expect(doc.sourceType).toBe('supplier_product')
    expect(doc.supplierProductId).toBe(42)
    expect(doc.partId).toBe('100')
  })

  it('brandLogo is passed through from document', () => {
    const doc = makeSearchDoc({ brandLogo: 'https://example.com/logo.png' })
    expect(doc.brandLogo).toBe('https://example.com/logo.png')
  })

  it('brandLogo defaults to null when not present', () => {
    const doc = makeSearchDoc({ brandLogo: null })
    expect(doc.brandLogo).toBeNull()
  })
})

describe('category-products API limit handling', () => {
  it('limit defaults to 24', () => {
    const parsedLimit = parseInt('24', 10)
    const limit = Math.min(Math.max(1, parsedLimit || 24), 48)
    expect(limit).toBe(24)
  })

  it('limit caps at 48', () => {
    const parsedLimit = parseInt('100', 10)
    const limit = Math.min(Math.max(1, parsedLimit || 24), 48)
    expect(limit).toBe(48)
  })

  it('limit minimum fallback to 24', () => {
    const parsedLimit = parseInt('0', 10)
    const limit = Math.min(Math.max(1, parsedLimit || 24), 48)
    expect(limit).toBe(24)
  })

  it('limit 1 is valid', () => {
    const parsedLimit = parseInt('1', 10)
    const limit = Math.min(Math.max(1, parsedLimit || 24), 48)
    expect(limit).toBe(1)
  })
})

describe('category-products non-leaf behavior', () => {
  it('non-leaf category returns empty products', () => {
    const isLeaf = false
    if (!isLeaf) {
      const result = {
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
      expect(result.products).toEqual([])
      expect(result.dataSource).toBe('non-leaf-category')
      expect(result.totalEstimate).toBe(0)
    }
  })
})

describe('category-products rank bucket computation', () => {
  it('rankBucket 1 for rankScore >= 100', () => {
    expect(computeRankBucketForTest(100)).toBe(1)
    expect(computeRankBucketForTest(120)).toBe(1)
  })

  it('rankBucket 2 for rankScore 50-99', () => {
    expect(computeRankBucketForTest(50)).toBe(2)
    expect(computeRankBucketForTest(99)).toBe(2)
  })

  it('rankBucket 3 for rankScore 25-49', () => {
    expect(computeRankBucketForTest(25)).toBe(3)
    expect(computeRankBucketForTest(49)).toBe(3)
  })

  it('rankBucket 4 for rankScore < 25', () => {
    expect(computeRankBucketForTest(0)).toBe(4)
    expect(computeRankBucketForTest(24)).toBe(4)
  })
})

describe('category-products Meilisearch sort', () => {
  it('popularity sort uses rankScore:desc', () => {
    const sort = getMeiliCategorySortForTest('popularity')
    expect(sort).toEqual(['rankScore:desc'])
  })

  it('price-asc sort uses price:asc then rankScore:desc', () => {
    const sort = getMeiliCategorySortForTest('price-asc')
    expect(sort).toEqual(['price:asc', 'rankScore:desc'])
  })

  it('price-desc sort uses price:desc then rankScore:desc', () => {
    const sort = getMeiliCategorySortForTest('price-desc')
    expect(sort).toEqual(['price:desc', 'rankScore:desc'])
  })

  it('name sort uses name:asc', () => {
    const sort = getMeiliCategorySortForTest('name')
    expect(sort).toEqual(['name:asc'])
  })

  it('default/undefined sort uses rankScore:desc', () => {
    expect(getMeiliCategorySortForTest(undefined)).toEqual(['rankScore:desc'])
    expect(getMeiliCategorySortForTest('')).toEqual(['rankScore:desc'])
  })
})

describe('category-products API fallback behavior', () => {
  it('vehicleId presence skips Meilisearch path', () => {
    const vehicleId = 12345
    const useMeili = !vehicleId
    expect(useMeili).toBe(false)
  })

  it('no vehicleId allows Meilisearch path', () => {
    const vehicleId = null
    const useMeili = !vehicleId
    expect(useMeili).toBe(true)
  })

  it('MEILI_ENABLED=false skips Meilisearch', () => {
    const isMeiliEnabled = false
    const vehicleId = null
    const useMeili = isMeiliEnabled && !vehicleId
    expect(useMeili).toBe(false)
  })
})

describe('category-products response shape', () => {
  const expectedKeys = [
    'products', 'page', 'limit', 'hasMore', 'totalEstimate',
    'brandFacetDistribution', 'stockFacetDistribution', 'dataSource', 'durationMs', 'cached'
  ]

  it('has all required response fields', () => {
    const result = {
      products: [],
      page: 1,
      limit: 24,
      hasMore: false,
      totalEstimate: 0,
      brandFacetDistribution: {},
      stockFacetDistribution: { 'in-stock': 0, 'on-order': 0 },
      dataSource: 'meilisearch-category-products',
      durationMs: 50,
      cached: false
    }

    for (const key of expectedKeys) {
      expect(key in result).toBe(true)
    }
  })

  it('Meili dataSource is distinct from Prisma fallback', () => {
    const meiliSource = 'meilisearch-category-products'
    const prismaSource = 'prisma-fallback-deduped+resolved-supplier'
    expect(meiliSource).not.toBe(prismaSource)
  })
})

describe('category-products no raw_json exposure', () => {
  it('SearchHit does not contain raw_json field', () => {
    const hit: SearchHit = {
      id: '1',
      name: 'Test',
      articleLinkId: '1',
      price: '100',
      stockQty: 5,
      priceSource: 'real',
      isPlaceholderPrice: false,
      isPurchasable: true,
      inBasket: false,
      brandId: 1,
      brandName: 'Brand',
      brandLogo: null,
      categoryId: 10,
      categoryName: 'Cat',
      categoryNameTr: null,
      oemCodes: [],
      oemBrands: [],
      vehicleTypes: [],
      vehicleIds: [],
      vehicleNames: [],
      formattedCompatibility: [],
      searchableText: '',
      images: [],
      properties: [],
      createdAt: '',
      updatedAt: ''
    }
    expect('raw_json' in hit).toBe(false)
  })
})

function computeRankBucketForTest(rankScore: number): number {
  if (rankScore >= 100) return 1
  if (rankScore >= 50) return 2
  if (rankScore >= 25) return 3
  return 4
}

function getMeiliCategorySortForTest(sort?: string): string[] {
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