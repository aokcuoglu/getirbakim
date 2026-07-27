import { describe, expect, it } from 'bun:test'
import {
  brandIdFromCode,
  brandNamesAgree,
  findArticleCode,
  learnBrandId,
  searchPath,
  stripBrandPrefix
} from './repxpert-search'

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

describe('stripBrandPrefix', () => {
  it('numaranın başındaki marka adını atar', () => {
    // Katalogda VICTORREINZ ürünleri "REINZ 01-31555-01" diye duruyor;
    // TecDoc'taki makale numarası yalnız "01-31555-01".
    expect(stripBrandPrefix('VICTORREINZ', 'REINZ 01-31555-01')).toBe('01-31555-01')
    expect(stripBrandPrefix('FEBI', 'FEBI-19570')).toBe('19570')
  })

  it('markayla ilgisi olmayan öneki atmaz', () => {
    expect(stripBrandPrefix('CORTECO', 'ABC 12345')).toBe('ABC 12345')
  })

  it('rakamla başlayan numaraya dokunmaz', () => {
    // HELLA "1ND010377-071" — "1ND" marka öneki değil, numaranın parçası.
    expect(stripBrandPrefix('HELLA', '1ND010377-071')).toBe('1ND010377-071')
    expect(stripBrandPrefix('BOSCH', '0445110274')).toBe('0445110274')
  })

  it('geriye rakamsız ya da çok kısa bir kalıntı bırakacaksa atmaz', () => {
    expect(stripBrandPrefix('ELRING', 'ELRING SET')).toBe('ELRING SET')
    expect(stripBrandPrefix('ELRING', 'ELRING 12')).toBe('ELRING 12')
  })
})

describe('findArticleCode', () => {
  // Sitenin gerçek "0445110274" aramasından kısaltıldı: katalogdaki numara
  // sıkıştırılmış, TecDoc'taki yazılış boşluklu ve kod ona göre kuruluyor.
  const BOSCH_SEARCH = {
    products: [
      {
        code: 'Ext-TA-MzA6MCA0NDUgMTEwIDI3NA',
        brand: { name: 'BOSCH' },
        catalogArticleNumber: '0 445 110 274'
      },
      { code: 'Ext-TA-NjI2NDpSRi0wNDQ1MTEwMjc0', brand: { name: 'RUFRE' }, catalogArticleNumber: 'RF-0445110274' },
      { code: 'Ext-TA-NDc0MjpYLTA0NDUxMTAyNzQ', brand: { name: 'Buchli' }, catalogArticleNumber: 'X-0445110274' }
    ]
  }

  it('katalogdaki sıkıştırılmış numaradan sitenin ürün kodunu bulur', () => {
    expect(findArticleCode(BOSCH_SEARCH, 'BOSCH', '0445110274')).toBe(
      'Ext-TA-MzA6MCA0NDUgMTEwIDI3NA'
    )
  })

  it('marka öneki taşıyan numarayı da bulur', () => {
    const payload = {
      products: [
        {
          code: 'Ext-TA-OTowMS0zMTU1NS0wMQ',
          brand: { name: 'VICTOR REINZ' },
          catalogArticleNumber: '01-31555-01'
        }
      ]
    }
    expect(findArticleCode(payload, 'VICTORREINZ', 'REINZ 01-31555-01')).toBe(
      'Ext-TA-OTowMS0zMTU1NS0wMQ'
    )
  })

  it('başka markanın aynı numaralı ürününü kabul etmez', () => {
    expect(findArticleCode(BOSCH_SEARCH, 'DELPHI', '0445110274')).toBeNull()
  })

  it('numarası tutmayan sonuçtan kod üretmez', () => {
    expect(findArticleCode(BOSCH_SEARCH, 'BOSCH', '9999999999')).toBeNull()
  })

  it('aynı markada iki farklı kod tutuyorsa hiçbirini kabul etmez', () => {
    const ambiguous = {
      products: [
        { code: 'Ext-TA-AAAA', brand: { name: 'BOSCH' }, catalogArticleNumber: '0 445 110 274' },
        { code: 'Ext-TA-BBBB', brand: { name: 'BOSCH' }, catalogArticleNumber: '0445110274' }
      ]
    }
    expect(findArticleCode(ambiguous, 'BOSCH', '0445110274')).toBeNull()
  })

  it('boş/bozuk yanıtta null döner', () => {
    expect(findArticleCode(null, 'BOSCH', '0445110274')).toBeNull()
    expect(findArticleCode({ products: [] }, 'BOSCH', '0445110274')).toBeNull()
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
