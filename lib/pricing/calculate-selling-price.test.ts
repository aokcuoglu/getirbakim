// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import {
  calculateSellingPrice,
  normalizeRate,
  resolvePricingPolicyFromProviderConfig,
  resolvePricingPolicy,
  roundHalfUp
} from './calculate-selling-price'

describe('pricing helpers', () => {
  it('normalizes percentage-like values', () => {
    expect(normalizeRate(10)).toBe(0.1)
    expect(normalizeRate('12.5')).toBe(0.125)
    expect(normalizeRate('7,5')).toBe(0)
    expect(normalizeRate('15%')).toBe(0.15)
  })

  it('applies half-up rounding for positive numbers', () => {
    expect(roundHalfUp(10.124, 2)).toBe(10.12)
    expect(roundHalfUp(10.125, 2)).toBe(10.13)
  })

  it('resolves policy defaults', () => {
    const policy = resolvePricingPolicy({
      standardDiscountRate: 12,
      marginRate: 0.2,
      fixedFee: 5
    })

    expect(policy.standardDiscountRate).toBe(0.12)
    expect(policy.marginRate).toBe(0.2)
    expect(policy.fixedFee).toBe(5)
    expect(policy.rounding).toBe('HALF_UP_2')
    expect(policy.vatMode).toBe('EXCLUDED')
  })

  it('reads pricing block from provider config', () => {
    const policy = resolvePricingPolicyFromProviderConfig({
      pricing: {
        standardDiscountRate: 15,
        marginRate: 18,
        fixedFee: 2.5,
        rounding: 'HALF_UP_2',
        vatMode: 'EXCLUDED'
      }
    })

    expect(policy.standardDiscountRate).toBe(0.15)
    expect(policy.marginRate).toBe(0.18)
    expect(policy.fixedFee).toBe(2.5)
  })
})

describe('calculateSellingPrice', () => {
  it('calculates ex-vat selling with discount + campaign + margin + fixed fee', () => {
    const result = calculateSellingPrice({
      supplierPrice: 100,
      campaignRate: 0.1,
      policy: {
        standardDiscountRate: 0.2,
        marginRate: 0.25,
        fixedFee: 3
      }
    })

    expect(result.netCostExVat).toBe(72)
    expect(result.sellingExVat).toBe(93)
    expect(result.usedOverride).toBe(false)
  })

  it('uses override when lockPrice is true', () => {
    const result = calculateSellingPrice({
      supplierPrice: 100,
      campaignRate: 0.3,
      overridePrice: 119.995,
      lockPrice: true,
      policy: {
        standardDiscountRate: 0.5,
        marginRate: 0.4,
        fixedFee: 0
      }
    })

    expect(result.usedOverride).toBe(true)
    expect(result.sellingExVat).toBe(120)
  })

  it('returns null price when supplier price is invalid', () => {
    const result = calculateSellingPrice({
      supplierPrice: null,
      policy: {
        standardDiscountRate: 0.1,
        marginRate: 0.3,
        fixedFee: 1
      }
    })

    expect(result.netCostExVat).toBeNull()
    expect(result.sellingExVat).toBeNull()
  })
})
