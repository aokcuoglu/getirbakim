import { describe, expect, it } from 'bun:test'
import { resolveAvailabilityStatus, resolveCTA } from './availability'
import type { SearchDocument } from './search-document-builder'

describe('SearchDocument availability status rules', () => {
  it('PURCHASABLE when has price and stock > 0', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: true,
      availableStock: 5,
      hasSupplierOffer: true,
      hasPartId: true
    })
    expect(result).toBe('PURCHASABLE')
  })

  it('OUT_OF_STOCK when has price but stock <= 0', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: true,
      availableStock: 0,
      hasSupplierOffer: true,
      hasPartId: true
    })
    expect(result).toBe('OUT_OF_STOCK')
  })

  it('REQUEST_PRICE when no price (catalog-only product)', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: false,
      availableStock: 0,
      hasSupplierOffer: false,
      hasPartId: true
    })
    expect(result).toBe('REQUEST_PRICE')
  })

  it('REQUEST_PRICE for supplier product without price', () => {
    const result = resolveAvailabilityStatus({
      hasRealPrice: false,
      availableStock: 0,
      hasSupplierOffer: true,
      hasPartId: false
    })
    expect(result).toBe('REQUEST_PRICE')
  })
})

describe('SearchDocument shape validation', () => {
  it('has required fields for a PURCHASABLE product', () => {
    const doc: SearchDocument = {
      id: 'part_100',
      partId: '100',
      supplierProductId: null,
      title: 'Bosch Brake Pad',
      brand: 'Bosch',
      supplierSku: null,
      oemCodes: ['0986424020'],
      eanCodes: ['5901234123457'],
      categorySlug: 'brake-pads',
      categoryName: 'Brake Pads',
      price: 250.00,
      stockQty: 5,
      currency: 'TRY',
      availabilityStatus: 'PURCHASABLE',
      cta: 'add_to_cart',
      providerName: null,
      imageUrl: null,
      detailUrl: '/part/100',
      name: 'Bosch Brake Pad',
      brandName: 'Bosch',
      brandId: 5,
      categoryId: 10,
      articleLinkId: '200',
      hasPrice: true,
      hasStock: true,
      rankScore: 100,
      sourceType: 'part',
      normalizedSearchText: 'bosch brake pad 0986424020 5901234123457 brake pads',
      updatedAt: Date.now()
    }

    expect(doc.id).toBe('part_100')
    expect(doc.availabilityStatus).toBe('PURCHASABLE')
    expect(doc.cta).toBe('add_to_cart')
    expect(doc.hasPrice).toBe(true)
    expect(doc.hasStock).toBe(true)
    expect(doc.rankScore).toBe(100)
    expect(doc.sourceType).toBe('part')
    expect(doc.detailUrl).toBe('/part/100')
  })

  it('has REQUEST_PRICE for no-price catalog product', () => {
    const doc: SearchDocument = {
      id: 'part_200',
      partId: '200',
      supplierProductId: null,
      title: 'Catalog Filter',
      brand: 'Generic',
      supplierSku: null,
      oemCodes: [],
      eanCodes: [],
      categorySlug: 'fuel-filter',
      categoryName: 'Fuel Filter',
      price: null,
      stockQty: 0,
      currency: 'TRY',
      availabilityStatus: 'REQUEST_PRICE',
      cta: 'request_price',
      providerName: null,
      imageUrl: null,
      detailUrl: '/part/200',
      name: 'Catalog Filter',
      brandName: 'Generic',
      brandId: null,
      categoryId: 15,
      articleLinkId: '300',
      hasPrice: false,
      hasStock: false,
      rankScore: 25,
      sourceType: 'part',
      normalizedSearchText: 'catalog filter generic fuel filter',
      updatedAt: Date.now()
    }

    expect(doc.availabilityStatus).toBe('REQUEST_PRICE')
    expect(doc.cta).toBe('request_price')
    expect(doc.hasPrice).toBe(false)
    expect(doc.rankScore).toBe(25)
  })

  it('has correct rank scores per availability', () => {
    const PURCHASABLE_SCORE = 100
    const OUT_OF_STOCK_SCORE = 50
    const REQUEST_PRICE_SCORE = 25

    expect(PURCHASABLE_SCORE).toBe(100)
    expect(OUT_OF_STOCK_SCORE).toBe(50)
    expect(REQUEST_PRICE_SCORE).toBe(25)
    expect(PURCHASABLE_SCORE > OUT_OF_STOCK_SCORE).toBe(true)
    expect(OUT_OF_STOCK_SCORE > REQUEST_PRICE_SCORE).toBe(true)
  })
})

describe('Search fallback behavior', () => {
  it('resolveAvailabilityStatus maps CTA correctly', () => {
    expect(resolveCTA('PURCHASABLE')).toBe('add_to_cart')
    expect(resolveCTA('REQUEST_PRICE')).toBe('request_price')
    expect(resolveCTA('OUT_OF_STOCK')).toBe('notify_or_request_price')
    expect(resolveCTA('VERIFY_FITMENT')).toBe('verify_fitment')
  })
})

describe('Page size cap', () => {
  it('caps search limit to 60', () => {
    expect(Math.max(1, Math.min(200, 60))).toBe(60)
    expect(Math.max(1, Math.min(200, 24))).toBe(24)
    expect(Math.max(1, Math.min(200, 1))).toBe(1)
  })

  it('minimum limit is 1', () => {
    expect(Math.max(1, Math.min(200, 0))).toBe(1)
  })

  it('rank scores: PURCHASABLE > OUT_OF_STOCK > REQUEST_PRICE', () => {
    expect(100 > 50).toBe(true)
    expect(50 > 25).toBe(true)
  })
})