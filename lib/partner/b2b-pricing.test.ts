import { describe, expect, it } from 'bun:test'
import { Prisma } from '@prisma/client'
import {
  DEFAULT_PARTNER_DISCOUNT_BPS,
  MAX_PARTNER_DISCOUNT_BPS,
  PARTNER_CURRENCY,
  PARTNER_VAT_RATE_BPS,
  resolvePartnerDiscountBps,
  resolvePartnerPrice,
  toKurus
} from './b2b-pricing'

describe('toKurus', () => {
  it('converts TRY decimals to integer kurus', () => {
    expect(toKurus(new Prisma.Decimal('1234.56'))).toBe(123456)
    expect(toKurus(99)).toBe(9900)
    expect(toKurus('0.01')).toBe(1)
  })

  it('rounds half up instead of truncating', () => {
    expect(toKurus(1.005)).toBe(101)
    expect(toKurus(1.004)).toBe(100)
    expect(toKurus(0.005)).toBe(1)
  })

  it('returns null for missing values and clamps negatives to zero', () => {
    expect(toKurus(null)).toBeNull()
    expect(toKurus(undefined)).toBeNull()
    expect(toKurus(-5)).toBe(0)
  })
})

describe('resolvePartnerDiscountBps', () => {
  it('falls back to the zero default when unset or invalid', () => {
    expect(resolvePartnerDiscountBps(undefined)).toBe(DEFAULT_PARTNER_DISCOUNT_BPS)
    expect(resolvePartnerDiscountBps('')).toBe(DEFAULT_PARTNER_DISCOUNT_BPS)
    expect(resolvePartnerDiscountBps('abc')).toBe(DEFAULT_PARTNER_DISCOUNT_BPS)
    expect(resolvePartnerDiscountBps('-100')).toBe(DEFAULT_PARTNER_DISCOUNT_BPS)
  })

  it('reads a configured rate and clamps it to the maximum', () => {
    expect(resolvePartnerDiscountBps('1500')).toBe(1500)
    expect(resolvePartnerDiscountBps('99999')).toBe(MAX_PARTNER_DISCOUNT_BPS)
  })
})

describe('resolvePartnerPrice', () => {
  it('applies the requested discount to the storefront ex-VAT price', () => {
    const price = resolvePartnerPrice({
      sellingPriceExVat: new Prisma.Decimal('100.00'),
      netCostExVat: new Prisma.Decimal('50.00'),
      discountBps: 1500
    })
    expect(price.listPriceKurus).toBe(10000)
    expect(price.b2bPriceKurus).toBe(8500)
    expect(price.discountBps).toBe(1500)
    expect(price.floorApplied).toBe(false)
    expect(price.currency).toBe(PARTNER_CURRENCY)
    expect(price.vatRateBps).toBe(PARTNER_VAT_RATE_BPS)
  })

  it('never prices below net cost and reports the effective discount', () => {
    const price = resolvePartnerPrice({
      sellingPriceExVat: new Prisma.Decimal('100.00'),
      netCostExVat: new Prisma.Decimal('95.00'),
      discountBps: 3000
    })
    expect(price.b2bPriceKurus).toBe(9500)
    expect(price.floorApplied).toBe(true)
    // İstenen %30 değil, gerçekten uygulanan %5 raporlanır.
    expect(price.discountBps).toBe(500)
  })

  it('does not let the cost floor push the price above the list price', () => {
    const price = resolvePartnerPrice({
      sellingPriceExVat: new Prisma.Decimal('100.00'),
      netCostExVat: new Prisma.Decimal('130.00'),
      discountBps: 1000
    })
    expect(price.b2bPriceKurus).toBe(10000)
    expect(price.discountBps).toBe(0)
  })

  it('applies no floor when net cost is unknown', () => {
    const price = resolvePartnerPrice({
      sellingPriceExVat: new Prisma.Decimal('100.00'),
      netCostExVat: null,
      discountBps: 2000
    })
    expect(price.b2bPriceKurus).toBe(8000)
    expect(price.floorApplied).toBe(false)
  })

  it('passes an unpriced product through as null', () => {
    const price = resolvePartnerPrice({
      sellingPriceExVat: null,
      netCostExVat: new Prisma.Decimal('10.00'),
      discountBps: 1500
    })
    expect(price.listPriceKurus).toBeNull()
    expect(price.b2bPriceKurus).toBeNull()
    expect(price.discountBps).toBe(0)
  })

  it('rounds the discounted price half up to whole kurus', () => {
    // 33.33 TRY - %1 => 3300.  (3333 * 9900 / 10000 = 3299.67)
    const price = resolvePartnerPrice({
      sellingPriceExVat: new Prisma.Decimal('33.33'),
      netCostExVat: null,
      discountBps: 100
    })
    expect(price.b2bPriceKurus).toBe(3300)
  })

  it('clamps an out-of-range discount instead of returning a negative price', () => {
    const price = resolvePartnerPrice({
      sellingPriceExVat: new Prisma.Decimal('100.00'),
      netCostExVat: null,
      discountBps: 50000
    })
    expect(price.b2bPriceKurus).toBe(1000)
  })
})
