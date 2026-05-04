import { describe, expect, it } from 'bun:test'
import {
  formatOrderNumber,
  parseOrderNumber,
  shouldReleaseReservedStock,
  toVatIncludedDecimal
} from '@/lib/orders/types'

describe('order helpers', () => {
  it('formats and parses order numbers', () => {
    expect(formatOrderNumber(123)).toBe('GB-000123')
    expect(parseOrderNumber('GB-000123')).toBe(123)
    expect(parseOrderNumber('123')).toBe(123)
  })

  it('releases reserved stock only for terminal failure states', () => {
    expect(shouldReleaseReservedStock('PAYMENT_FAILED')).toBe(true)
    expect(shouldReleaseReservedStock('CANCELLED')).toBe(true)
    expect(shouldReleaseReservedStock('REFUNDED')).toBe(true)
    expect(shouldReleaseReservedStock('PROCESSING')).toBe(false)
  })

  it('converts ex-vat prices to display prices', () => {
    expect(toVatIncludedDecimal('100')?.toString()).toBe('120')
    expect(toVatIncludedDecimal('948.01')?.toString()).toBe('1137.61')
  })
})
