import { describe, expect, it } from 'bun:test'
import { deriveDproductsPartNo, extractStockCodeFromStokKodu } from '../dproducts-part-no'
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
    expect(source.includes('batchUpsertDproductDetails')).toBe(true)
    expect(source.includes('dbrands_id')).toBe(true)
    expect(source.includes('ON CONFLICT (dbrands_id, stock_code)')).toBe(true)
  })
})

describe('deriveDproductsPartNo', () => {
  it('uses suffix after first space in stock_code', () => {
    expect(deriveDproductsPartNo('BOSCH 0258017001')).toBe('0258017001')
  })
})

describe('extractStockCodeFromStokKodu', () => {
  it('extracts suffix after brand prefix', () => {
    expect(extractStockCodeFromStokKodu('KRAFTVOLL 07040001')).toBe('07040001')
  })

  it('joins remainder when multiple spaces follow brand', () => {
    expect(extractStockCodeFromStokKodu('BRAND ABC 123')).toBe('ABC 123')
  })

  it('returns full value when no space separator', () => {
    expect(extractStockCodeFromStokKodu('07040001')).toBe('07040001')
  })

  it('returns null for non-string input', () => {
    expect(extractStockCodeFromStokKodu(null)).toBeNull()
  })
})
