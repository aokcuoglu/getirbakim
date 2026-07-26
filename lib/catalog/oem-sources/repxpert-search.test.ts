import { describe, expect, it } from 'bun:test'
import { brandIdFromCode, brandNamesAgree, learnBrandId, searchPath } from './repxpert-search'

// Sitenin "01044" aramasından kısaltılmış, gerçek kodlarla.
const PAYLOAD = {
  products: [
    // Bulanık sonuç: numara tutmuyor.
    { code: 'TA-479-6231089000', brand: { name: 'Schaeffler LuK' }, catalogArticleNumber: '623 1089 00' },
    { code: 'Ext-TA-MTAxOjAxMDQ0', brand: { name: 'FEBI BILSTEIN' }, catalogArticleNumber: '01044' },
    { code: 'Ext-TA-Mjg2OjAxMDQ0', brand: { name: 'KAWE' }, catalogArticleNumber: '01044' },
    { code: 'Ext-TA-NDY4MzowMTA0NA', brand: { name: 'OSSCA' }, catalogArticleNumber: '01044' }
  ]
}

describe('brandIdFromCode', () => {
  it('Ext-TA base64 kodundan marka id"sini çözer', () => {
    expect(brandIdFromCode('Ext-TA-MTAxOjAxMDQ0')).toBe(101)
    expect(brandIdFromCode('Ext-TA-NDk5NzoxMFBLMTUyMA')).toBe(4997)
  })

  it('Schaeffler biçimindeki TA-<marka>-<makale> kodunu da çözer', () => {
    expect(brandIdFromCode('TA-479-6231089000')).toBe(479)
  })

  it('tanınmayan biçimde null döner', () => {
    expect(brandIdFromCode('')).toBeNull()
    expect(brandIdFromCode('P-12345')).toBeNull()
  })
})

describe('brandNamesAgree', () => {
  it('katalog adı sitedeki adın kısaltması olabilir', () => {
    expect(brandNamesAgree('FEBI', 'FEBI BILSTEIN')).toBe(true)
    expect(brandNamesAgree('VICTORREINZ', 'Victor Reinz')).toBe(true)
    expect(brandNamesAgree('OSSCA', 'OSSCA')).toBe(true)
  })

  it('farklı markaları eşleştirmez', () => {
    expect(brandNamesAgree('FEBI', 'KAWE')).toBe(false)
    expect(brandNamesAgree('BOSCH', 'BOSAL')).toBe(false)
  })

  it('çok kısa adlarda eşleştirme yapmaz', () => {
    expect(brandNamesAgree('GK', 'GKN')).toBe(false)
  })
})

describe('learnBrandId', () => {
  it('numarası ve markası tutan tek kayıttan id öğrenir', () => {
    expect(learnBrandId(PAYLOAD, 'FEBI', '01044')).toEqual({
      brandId: 101,
      siteBrand: 'FEBI BILSTEIN',
      code: 'Ext-TA-MTAxOjAxMDQ0'
    })
    expect(learnBrandId(PAYLOAD, 'OSSCA', '01044')?.brandId).toBe(4683)
  })

  it('markası bulunmayan sorguda null döner', () => {
    expect(learnBrandId(PAYLOAD, 'KRAFTVOLL', '01044')).toBeNull()
  })

  it('numarası tutmayan kayıttan id öğrenmez', () => {
    expect(learnBrandId(PAYLOAD, 'FEBI', '99999')).toBeNull()
  })

  it('iki farklı marka id"si tutuyorsa hiçbirini kabul etmez', () => {
    const ambiguous = {
      products: [
        { code: 'Ext-TA-MTAxOjAxMDQ0', brand: { name: 'FEBI' }, catalogArticleNumber: '01044' },
        { code: 'Ext-TA-Mjg2OjAxMDQ0', brand: { name: 'FEBI BILSTEIN' }, catalogArticleNumber: '01044' }
      ]
    }
    expect(learnBrandId(ambiguous, 'FEBI', '01044')).toBeNull()
  })

  it('boş/bozuk yanıtta null döner', () => {
    expect(learnBrandId(null, 'FEBI', '01044')).toBeNull()
    expect(learnBrandId({ products: [] }, 'FEBI', '01044')).toBeNull()
  })
})

describe('searchPath', () => {
  it('sitenin kendi arama isteğiyle aynı biçimi kurar', () => {
    const path = searchPath('01044')
    expect(path.startsWith('/api/Repxpert-TR/products/search?')).toBe(true)
    expect(path.includes('query=01044%3Arelevance')).toBe(true)
    expect(path.includes('source=globalsearch')).toBe(true)
  })
})
