import { describe, expect, it } from 'bun:test'
import {
  resolveAvailabilityStatus,
  resolveCTA,
  AVAILABILITY_CTA_LABELS,
  resolveDetailUrl,
  type AvailabilityInput
} from './availability'

describe('resolveAvailabilityStatus', () => {
  it('returns PURCHASABLE when has real price and stock', () => {
    const input: AvailabilityInput = {
      hasRealPrice: true,
      availableStock: 5,
      hasPartId: true
    }
    expect(resolveAvailabilityStatus(input)).toBe('PURCHASABLE')
  })

  it('returns OUT_OF_STOCK when has real price but no stock', () => {
    const input: AvailabilityInput = {
      hasRealPrice: true,
      availableStock: 0,
      hasPartId: true
    }
    expect(resolveAvailabilityStatus(input)).toBe('OUT_OF_STOCK')
  })

  it('returns REQUEST_PRICE when no price', () => {
    const input: AvailabilityInput = {
      hasRealPrice: false,
      availableStock: 0,
      hasPartId: false
    }
    expect(resolveAvailabilityStatus(input)).toBe('REQUEST_PRICE')
  })

  it('returns REQUEST_PRICE for catalog-only part', () => {
    const input: AvailabilityInput = {
      hasRealPrice: false,
      availableStock: 0,
      hasPartId: true
    }
    expect(resolveAvailabilityStatus(input)).toBe('REQUEST_PRICE')
  })

  it('returns REQUEST_PRICE default fallback', () => {
    const input: AvailabilityInput = {
      hasRealPrice: false,
      availableStock: 0,
      hasPartId: false
    }
    expect(resolveAvailabilityStatus(input)).toBe('REQUEST_PRICE')
  })
})

describe('resolveCTA', () => {
  it('maps PURCHASABLE to add_to_cart', () => {
    expect(resolveCTA('PURCHASABLE')).toBe('add_to_cart')
  })

  it('maps REQUEST_PRICE to request_price', () => {
    expect(resolveCTA('REQUEST_PRICE')).toBe('request_price')
  })

  it('maps VERIFY_FITMENT to verify_fitment', () => {
    expect(resolveCTA('VERIFY_FITMENT')).toBe('verify_fitment')
  })

  it('maps OUT_OF_STOCK to notify_or_request_price', () => {
    expect(resolveCTA('OUT_OF_STOCK')).toBe('notify_or_request_price')
  })
})

describe('AVAILABILITY_CTA_LABELS', () => {
  it('has Turkish labels for PURCHASABLE', () => {
    expect(AVAILABILITY_CTA_LABELS.PURCHASABLE.tr).toBe('Sepete Ekle')
  })

  it('has Turkish labels for REQUEST_PRICE', () => {
    expect(AVAILABILITY_CTA_LABELS.REQUEST_PRICE.tr).toBe('Fiyat Al')
  })

  it('has Turkish labels for VERIFY_FITMENT', () => {
    expect(AVAILABILITY_CTA_LABELS.VERIFY_FITMENT.tr).toBe('Uygunluk Sor')
  })

  it('has Turkish labels for OUT_OF_STOCK', () => {
    expect(AVAILABILITY_CTA_LABELS.OUT_OF_STOCK.tr).toBe('Stok Gelince Haber Ver')
  })
})

describe('resolveDetailUrl', () => {
  it('returns /part/[id] when partId exists', () => {
    expect(resolveDetailUrl({ partId: '123' })).toBe('/part/123')
  })

  it('returns null when no partId', () => {
    expect(resolveDetailUrl({})).toBeNull()
  })
})