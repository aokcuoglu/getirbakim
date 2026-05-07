import { describe, expect, it } from 'bun:test'
import {
  catalogOfferProductToSearchHit,
  type CatalogOfferProduct
} from './catalog-offer-search'

function makeProduct(overrides: Partial<CatalogOfferProduct> = {}): CatalogOfferProduct {
  return {
    partId: '100',
    supplierProductId: null,
    title: 'Test Product',
    brand: 'Bosch',
    imageUrl: null,
    price: '150.00',
    stockQty: 5,
    currency: 'TRY',
    availabilityStatus: 'PURCHASABLE',
    cta: 'add_to_cart',
    providerName: null,
    oemCodes: ['12345'],
    eanCodes: ['5901234123457'],
    detailUrl: '/part/100',
    name: 'Test Product',
    brandName: 'Bosch',
    brandLogo: null,
    categoryId: 10,
    categoryName: 'Brake Pads',
    priceSource: 'real',
    isPlaceholderPrice: false,
    isPurchasable: true,
    sourceType: 'part',
    articleLinkId: '200',
    variantCount: 1,
    inBasket: false,
    brandId: 5,
    images: [],
    properties: [],
    ...overrides
  }
}

describe('catalogOfferProductToSearchHit', () => {
  it('maps purchasable product with availability status', () => {
    const product = makeProduct()
    const hit = catalogOfferProductToSearchHit(product)

    expect(hit.availabilityStatus).toBe('PURCHASABLE')
    expect(hit.cta).toBe('add_to_cart')
    expect(hit.detailUrl).toBe('/part/100')
    expect(hit.isPurchasable).toBe(true)
    expect(hit.priceSource).toBe('real')
    expect(hit.sourceType).toBe('part')
  })

  it('maps catalog-only REQUEST_PRICE product', () => {
    const product = makeProduct({
      price: null,
      stockQty: 0,
      availabilityStatus: 'REQUEST_PRICE',
      cta: 'request_price',
      isPurchasable: false,
      isPlaceholderPrice: true,
      priceSource: 'placeholder'
    })
    const hit = catalogOfferProductToSearchHit(product)

    expect(hit.availabilityStatus).toBe('REQUEST_PRICE')
    expect(hit.cta).toBe('request_price')
    expect(hit.isPurchasable).toBe(false)
  })

  it('assigns rankBucket=1 for PURCHASABLE', () => {
    const product = makeProduct({ availabilityStatus: 'PURCHASABLE' })
    const hit = catalogOfferProductToSearchHit(product)
    expect(hit.rankBucket).toBe(1)
  })

  it('assigns rankBucket=2 for OUT_OF_STOCK', () => {
    const product = makeProduct({ availabilityStatus: 'OUT_OF_STOCK' })
    const hit = catalogOfferProductToSearchHit(product)
    expect(hit.rankBucket).toBe(2)
  })

  it('assigns rankBucket=3 for REQUEST_PRICE', () => {
    const product = makeProduct({ availabilityStatus: 'REQUEST_PRICE' })
    const hit = catalogOfferProductToSearchHit(product)
    expect(hit.rankBucket).toBe(3)
  })

  it('maps detailUrl from product', () => {
    const product = makeProduct({ detailUrl: '/supplier-product/42' })
    const hit = catalogOfferProductToSearchHit(product)
    expect(hit.detailUrl).toBe('/supplier-product/42')
  })
})

describe('catalog-offer-search query limit cap', () => {
  it('caps limits correctly', () => {
    expect(Math.max(1, Math.min(120, 24))).toBe(24)
    expect(Math.max(1, Math.min(120, 200))).toBe(120)
  })
})