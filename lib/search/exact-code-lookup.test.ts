import { describe, it, expect } from 'bun:test'
import { isExactCodeQuery, mergeExactCodeResults } from './exact-code-lookup'
import type { CatalogOfferProduct } from './catalog-offer-search'

describe('isExactCodeQuery (from exact-code-lookup)', () => {
  it('delegates to code-normalization isExactCodeQuery', () => {
    expect(isExactCodeQuery('0445110376')).toBe(true)
    expect(isExactCodeQuery('Bosch')).toBe(false)
    expect(isExactCodeQuery('short')).toBe(false)
  })

  it('recognizes OEM codes with spaces and dashes', () => {
    expect(isExactCodeQuery('0 445 110 376')).toBe(true)
  })

  it('recognizes short codes that have enough digits', () => {
    expect(isExactCodeQuery('B1234')).toBe(true)
  })
})

describe('mergeExactCodeResults', () => {
  const makeProduct = (overrides: Partial<CatalogOfferProduct> = {}): CatalogOfferProduct => ({
    partId: null,
    supplierProductId: null,
    title: 'Test Product',
    brand: 'Test Brand',
    imageUrl: null,
    price: '100',
    stockQty: 5,
    currency: 'TRY',
    availabilityStatus: 'PURCHASABLE',
    cta: 'add_to_cart',
    providerName: null,
    oemCodes: [],
    eanCodes: [],
    detailUrl: '/part/1',
    name: 'Test Product',
    brandName: 'Test Brand',
    brandLogo: null,
    categoryId: null,
    categoryName: null,
    categoryNameTr: null,
    priceSource: 'real',
    isPlaceholderPrice: false,
    isPurchasable: true,
    sourceType: 'part',
    articleLinkId: '1',
    variantCount: 1,
    inBasket: false,
    brandId: null,
    images: [],
    properties: [],
    documentType: 'canonical_part',
    canonicalPartId: null,
    matchStatus: 'UNMAPPED',
    matchConfidence: null,
    matchReason: null,
    hasSupplierOffer: false,
    offerCount: 0,
    bestOfferProvider: null,
    crossReferences: [],
    referenceNumbers: [],
    vehicleBrandNames: [],
    vehicleModelNames: [],
    fitmentCount: 0,
    ...overrides
  })

  it('places exact results before Meili results', () => {
    const exactResult = makeProduct({ partId: '100', title: 'Exact Match' })
    const meiliResult = makeProduct({ partId: '200', title: 'Meili Match' })

    const merged = mergeExactCodeResults([exactResult], [meiliResult])
    expect(merged[0].partId).toBe('100')
    expect(merged[1].partId).toBe('200')
    expect(merged.length).toBe(2)
  })

  it('deduplicates by partId', () => {
    const exactResult = makeProduct({ partId: '100', title: 'Exact Match', availabilityStatus: 'PURCHASABLE' })
    const meiliResult = makeProduct({ partId: '100', title: 'Meili Same Part', availabilityStatus: 'OUT_OF_STOCK' })

    const merged = mergeExactCodeResults([exactResult], [meiliResult])
    expect(merged.length).toBe(1)
    expect(merged[0].partId).toBe('100')
    expect(merged[0].title).toBe('Exact Match')
  })

  it('deduplicates by supplierProductId', () => {
    const exactResult = makeProduct({ supplierProductId: 500, title: 'Exact SP' })
    const meiliResult = makeProduct({ supplierProductId: 500, title: 'Meili Same SP' })

    const merged = mergeExactCodeResults([exactResult], [meiliResult])
    expect(merged.length).toBe(1)
    expect(merged[0].title).toBe('Exact SP')
  })

  it('preserves Meili-only results when no exact match', () => {
    const meiliResult = makeProduct({ partId: '200', title: 'Meili Only' })

    const merged = mergeExactCodeResults([], [meiliResult])
    expect(merged.length).toBe(1)
    expect(merged[0].partId).toBe('200')
  })

  it('returns only exact results when Meili returns empty', () => {
    const exactResult = makeProduct({ partId: '100', title: 'Exact Only' })

    const merged = mergeExactCodeResults([exactResult], [])
    expect(merged.length).toBe(1)
    expect(merged[0].partId).toBe('100')
  })

  it('handles mixed partId and supplierProductId deduplication', () => {
    const exactByPartId = makeProduct({ partId: '100', title: 'Exact Part' })
    const exactBySpId = makeProduct({ supplierProductId: 500, title: 'Exact SP' })
    const meiliByPartId = makeProduct({ partId: '100', title: 'Meili Same Part' })
    const meiliBySpId = makeProduct({ supplierProductId: 500, title: 'Meili Same SP' })
    const meiliUnique = makeProduct({ partId: '300', title: 'Meili Unique' })

    const merged = mergeExactCodeResults(
      [exactByPartId, exactBySpId],
      [meiliByPartId, meiliBySpId, meiliUnique]
    )
    expect(merged.length).toBe(3)
    expect(merged[0].partId).toBe('100')
    expect(merged[1].supplierProductId).toBe(500)
    expect(merged[2].partId).toBe('300')
  })
})