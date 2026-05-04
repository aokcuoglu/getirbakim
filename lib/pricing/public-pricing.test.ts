// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Prisma } from '@prisma/client'
import {
  computeAvailableStock,
  computePlaceholderPriceExVat,
  resolvePublicPriceAndPurchasability,
  resolveRealPriceExVat
} from './public-pricing'

describe('public pricing resolver', () => {
  it('prioritizes lock override for real price', () => {
    const real = resolveRealPriceExVat({
      price: new Prisma.Decimal('80'),
      part_pricing_inventory: {
        supplier_price: new Prisma.Decimal('90'),
        computed_selling_price_ex_vat: new Prisma.Decimal('100')
      },
      part_admin_overrides: {
        lock_price: true,
        selling_price_override: new Prisma.Decimal('119.99')
      }
    })

    expect(real?.toString()).toBe('119.99')
  })

  it('computes placeholder from category minimum with clamp + round', () => {
    expect(
      computePlaceholderPriceExVat(new Prisma.Decimal('100')).toString()
    ).toBe('90')
    expect(
      computePlaceholderPriceExVat(new Prisma.Decimal('10')).toString()
    ).toBe('50')
    expect(
      computePlaceholderPriceExVat(new Prisma.Decimal('9000')).toString()
    ).toBe('5000')
    expect(computePlaceholderPriceExVat(null).toString()).toBe('199')
  })

  it('marks placeholder as not purchasable even if stock exists', () => {
    const resolved = resolvePublicPriceAndPurchasability({
      realPriceExVat: null,
      categoryMinRealPriceExVat: new Prisma.Decimal('120'),
      stockQty: 5,
      reservedStockQty: 0
    })

    expect(resolved.priceSource).toBe('placeholder')
    expect(resolved.isPlaceholderPrice).toBe(true)
    expect(resolved.isPurchasable).toBe(false)
    expect(resolved.stockQty).toBe(5)
    expect(resolved.resolvedPriceExVat.toString()).toBe('108')
  })

  it('marks real-priced + in-stock items as purchasable', () => {
    const resolved = resolvePublicPriceAndPurchasability({
      realPriceExVat: new Prisma.Decimal('250'),
      stockQty: 8,
      reservedStockQty: 3
    })

    expect(resolved.priceSource).toBe('real')
    expect(resolved.isPlaceholderPrice).toBe(false)
    expect(resolved.availableStock).toBe(5)
    expect(resolved.isPurchasable).toBe(true)
  })

  it('normalizes missing stock to zero', () => {
    expect(computeAvailableStock({ stockQty: null })).toBe(0)
    expect(computeAvailableStock({ stockQty: undefined, reservedStockQty: 5 })).toBe(0)
  })
})
