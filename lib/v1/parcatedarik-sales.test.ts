import { describe, expect, it } from 'bun:test'
import {
  mapV1ParcatedarikRow,
  resolveV1ParcatedarikAvailability
} from './parcatedarik-sales'

describe('resolveV1ParcatedarikAvailability', () => {
  it('allows purchase only for approved/manual matches with positive price and stock', () => {
    expect(
      resolveV1ParcatedarikAvailability({
        matchStatus: 'APPROVED',
        price: '1250.50',
        stockQty: 4
      })
    ).toEqual({ availabilityStatus: 'PURCHASABLE', cta: 'ADD_TO_CART' })

    expect(
      resolveV1ParcatedarikAvailability({
        matchStatus: 'MANUAL_MATCH',
        price: '1',
        stockQty: 1
      })
    ).toEqual({ availabilityStatus: 'PURCHASABLE', cta: 'ADD_TO_CART' })
  })

  it('keeps non-approved matches visible but not purchasable', () => {
    expect(
      resolveV1ParcatedarikAvailability({
        matchStatus: 'CANDIDATE',
        price: '1250.50',
        stockQty: 4
      })
    ).toEqual({
      availabilityStatus: 'NEEDS_MATCH_REVIEW',
      cta: 'VERIFY_AVAILABILITY'
    })
  })

  it('requests price when an approved match has no positive price', () => {
    expect(
      resolveV1ParcatedarikAvailability({
        matchStatus: 'APPROVED',
        price: null,
        stockQty: 4
      })
    ).toEqual({ availabilityStatus: 'REQUEST_PRICE', cta: 'REQUEST_PRICE' })
  })

  it('blocks checkout when stock is not positive', () => {
    expect(
      resolveV1ParcatedarikAvailability({
        matchStatus: 'APPROVED',
        price: '1250.50',
        stockQty: 0
      })
    ).toEqual({ availabilityStatus: 'OUT_OF_STOCK', cta: 'REQUEST_PRICE' })
  })
})

describe('mapV1ParcatedarikRow', () => {
  it('serializes ids and omits Dinamik raw payloads', () => {
    const product = mapV1ParcatedarikRow({
      parcatedarik_product_id: 42,
      title: 'Fren Diski',
      image_url: 'https://example.test/image.jpg',
      model: '25100016',
      ref_no: '077903133G',
      manufacturer_name: 'ABA',
      dinamik_product_id: BigInt(99),
      stock_code: 'ABA 25100016',
      price: '1500',
      stock_qty: 3,
      currency: 'TRY',
      match_status: 'APPROVED'
    })

    expect(product.parcatedarikProductId).toBe('42')
    expect(product.dinamikProductId).toBe('99')
    expect(product.availabilityStatus).toBe('PURCHASABLE')
    expect(Object.prototype.hasOwnProperty.call(product, 'raw_json')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(product, 'rawJson')).toBe(false)
  })
})
