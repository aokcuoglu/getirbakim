import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEmptyDpmatchPopulateStats } from '../dpmatch-populate'
import {
  dproductNotUnderPairedApprovedBrand,
  pairedApprovedBrandMatchFilter,
  ptproductNotUnderPairedApprovedBrand,
  SINGLE_SIDE_APPROVED_MATCH_METHOD,
} from '@/lib/sql/dpmatch-exact'

describe('dpmatch-populate', () => {
  it('exports empty stats with new fields', () => {
    const stats = createEmptyDpmatchPopulateStats()
    expect(stats.brandMatches).toBe(0)
    expect(stats.exactMatchCandidates).toBe(0)
    expect(stats.exactMatchesInserted).toBe(0)
    expect(stats.dproductPlaceholders).toBe(0)
    expect(stats.invalidRowsDeleted).toBe(0)
    expect(stats.unpairedDproductCandidates).toBe(0)
    expect(stats.unpairedProductCandidates).toBe(0)
  })

  it('requires paired approved brand matches in populate SQL', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'dpmatch-populate.ts'),
      'utf8'
    )
    expect(source.includes('pairedApprovedBrandMatchFilter')).toBe(true)
    expect(source.includes('dpmatchExactPartNoModelFilter')).toBe(true)
    expect(source.includes('dproductNotUnderPairedApprovedBrand')).toBe(true)
    expect(source.includes('ptproductNotUnderPairedApprovedBrand')).toBe(true)
    expect(source.includes('insertApprovedDpmatchForUnpairedBrands')).toBe(true)
    expect(source.includes('DISTINCT ON')).toBe(false)
    expect(source.includes('barcode_1')).toBe(false)
  })

  it('paired brand filter requires both brand ids', () => {
    const sql = pairedApprovedBrandMatchFilter.strings.join('')
    expect(sql.includes('dbrands_id IS NOT NULL')).toBe(true)
    expect(sql.includes('ptbrands_id IS NOT NULL')).toBe(true)
    expect(sql.includes("mapping_status = 'APPROVED'")).toBe(true)
  })

  it('unpaired brand filters exclude approved paired matches only', () => {
    const dSql = dproductNotUnderPairedApprovedBrand.strings.join('')
    const pSql = ptproductNotUnderPairedApprovedBrand.strings.join('')
    expect(dSql.includes('NOT EXISTS')).toBe(true)
    expect(pSql.includes('NOT EXISTS')).toBe(true)
    expect(dSql.includes('dbrands_id = d.dbrands_id')).toBe(true)
    expect(pSql.includes('ptbrands_id = p.ptbrands_id')).toBe(true)
  })

  it('uses NO_BRAND_MATCH for single-side approved rows', () => {
    expect(SINGLE_SIDE_APPROVED_MATCH_METHOD).toBe('NO_BRAND_MATCH')
  })

  it('allows multiple exact-match pairs per dproduct in link SQL', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'dpmatch-link.ts'),
      'utf8'
    )
    expect(source.includes('DPRODUCT_ALREADY_LINKED')).toBe(false)
    expect(source.includes('PRODUCT_ALREADY_LINKED')).toBe(false)
    expect(source.includes('dproducts_id = ${input.dproductsId}\n        AND ptproducts_id = ${input.productId}')).toBe(true)
  })
})
