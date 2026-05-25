import { describe, expect, it } from 'bun:test'
import { deriveDproductsPartNo } from '../dproducts-part-no'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

describe('dproducts-stock-sync', () => {
  it('includes raw jsonb and passive flags in upsert SQL', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'dproducts-stock-sync.ts'),
      'utf8'
    )
    expect(source.includes('raw')).toBe(true)
    expect(source.includes('is_passive = false')).toBe(true)
    expect(source.includes('markDproductsBrandPassive')).toBe(true)
    expect(source.includes('batchUpsertDproductOffers')).toBe(true)
  })
})

describe('deriveDproductsPartNo', () => {
  it('uses suffix after first space in stock_code', () => {
    expect(deriveDproductsPartNo('BOSCH 0258017001')).toBe('0258017001')
  })
})
