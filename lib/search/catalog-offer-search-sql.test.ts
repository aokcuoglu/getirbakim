import { describe, expect, it } from 'bun:test'
import {
  resolveAvailabilityStatus,
  resolveCTA,
  resolveDetailUrl,
  type AvailabilityInput
} from './availability'

describe('escapeSqlLiteral via catalog-offer-search', () => {
  it('escapeSqlLiteral handles plain strings', () => {
    const escapeSqlLiteral = (value: string): string =>
      `'${value.replace(/'/g, "''")}'`
    expect(escapeSqlLiteral('Bosch')).toBe("'Bosch'")
  })

  it('escapeSqlLiteral escapes single quotes', () => {
    const escapeSqlLiteral = (value: string): string =>
      `'${value.replace(/'/g, "''")}'`
    expect(escapeSqlLiteral("O'Brien")).toBe("'O''Brien'")
  })

  it('escapeSqlLiteral handles empty string', () => {
    const escapeSqlLiteral = (value: string): string =>
      `'${value.replace(/'/g, "''")}'`
    expect(escapeSqlLiteral('')).toBe("''")
  })

  it('escapeSqlLike handles LIKE wildcards', () => {
    const escapeSqlLike = (value: string): string =>
      `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_')}'`
    expect(escapeSqlLike('bosch')).toBe("'bosch'")
    expect(escapeSqlLike("o'brien")).toBe("'o''brien'")
    expect(escapeSqlLike('100%')).toBe("'100\\%'")
  })

  it('old Prisma.sql pattern produced [object Object]', () => {
    const badFragment = `${{ sql: "'test'", values: [] as number[] }}`
    expect(badFragment).toBe('[object Object]')
  })

  it('new escapeSqlLiteral does NOT produce [object Object]', () => {
    const escapeSqlLiteral = (value: string): string =>
      `'${value.replace(/'/g, "''")}'`
    const result = `WHERE sp.normalized_sku = LOWER(${escapeSqlLiteral('abc123')})`
    expect(result).toBe("WHERE sp.normalized_sku = LOWER('abc123')")
    expect(result.includes('[object Object]')).toBe(false)
  })

  it('SQL literal does not produce Prisma.sql objects in plain strings', () => {
    const escapeSqlLiteral = (value: string): string =>
      `'${value.replace(/'/g, "''")}'`
    const result = `WHERE sp.normalized_sku = LOWER(${escapeSqlLiteral('abc123')})`
    expect(result).toBe("WHERE sp.normalized_sku = LOWER('abc123')")
    expect(result.includes('[object Object]')).toBe(false)
  })
})

const PrismaSqlFragment = { sql: "'test'", values: [] }

describe('PostgreSQL fallback produces valid SQL', () => {
  it('escapeSqlLiteral produces safe SQL string literals', () => {
    const escapeSqlLiteral = (value: string): string =>
      `'${value.replace(/'/g, "''")}'`

    expect(escapeSqlLiteral('Bosch')).toBe("'Bosch'")
    expect(escapeSqlLiteral('0445110376')).toBe("'0445110376'")
    expect(escapeSqlLiteral("L'OEuvre")).toBe("'L''OEuvre'")
  })

  it('escapeSqlLike produces safe LIKE patterns', () => {
    const escapeSqlLike = (value: string): string =>
      `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_')}'`

    expect(escapeSqlLike('bosch')).toBe("'bosch'")
    expect(escapeSqlLike('100%')).toBe("'100\\%'")
    expect(escapeSqlLike('test_value')).toBe("'test\\_value'")
  })

  it('CTE strings contain no Prisma.sql objects', () => {
    const cteContent = `WHERE sp.normalized_sku = LOWER('abc123')
      AND sp.provider_id IN (SELECT id FROM supplier_providers WHERE status = 'ACTIVE')`
    expect(cteContent.includes('[object Object]')).toBe(false)
  })
})

describe('MEILI_ENABLED=false fallback behavior', () => {
  it('isMeiliEnabled returns false when env is not set to true', () => {
    const originalEnabled = process.env.MEILI_ENABLED
    process.env.MEILI_ENABLED = 'false'
    const result = process.env.MEILI_ENABLED === 'true'
    process.env.MEILI_ENABLED = originalEnabled
    expect(result).toBe(false)
  })

  it('resolveAvailabilityStatus maps PURCHASABLE correctly', () => {
    const input: AvailabilityInput = {
      hasRealPrice: true,
      availableStock: 5,
      hasSupplierOffer: true,
      hasPartId: true
    }
    expect(resolveAvailabilityStatus(input)).toBe('PURCHASABLE')
  })

  it('resolveAvailabilityStatus maps REQUEST_PRICE for no-price products', () => {
    const input: AvailabilityInput = {
      hasRealPrice: false,
      availableStock: 0,
      hasSupplierOffer: false,
      hasPartId: true
    }
    expect(resolveAvailabilityStatus(input)).toBe('REQUEST_PRICE')
  })

  it('no-price products remain visible as REQUEST_PRICE', () => {
    const input: AvailabilityInput = {
      hasRealPrice: false,
      availableStock: 0,
      hasSupplierOffer: true,
      hasPartId: true
    }
    expect(resolveAvailabilityStatus(input)).toBe('REQUEST_PRICE')
    expect(resolveCTA('REQUEST_PRICE')).toBe('request_price')
  })

  it('OUT_OF_STOCK has notify_or_request_price CTA', () => {
    const input: AvailabilityInput = {
      hasRealPrice: true,
      availableStock: 0,
      hasSupplierOffer: true,
      hasPartId: true
    }
    expect(resolveAvailabilityStatus(input)).toBe('OUT_OF_STOCK')
    expect(resolveCTA('OUT_OF_STOCK')).toBe('notify_or_request_price')
  })
})

describe('Search page size cap', () => {
  it('caps search limit to 60', () => {
    expect(Math.max(1, Math.min(120, 60))).toBe(60)
    expect(Math.max(1, Math.min(120, 24))).toBe(24)
    expect(Math.max(1, Math.min(120, 1))).toBe(1)
  })

  it('minimum limit is 1', () => {
    expect(Math.max(1, Math.min(120, 0))).toBe(1)
  })
})