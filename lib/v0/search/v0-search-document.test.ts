import { describe, expect, it } from 'bun:test'
import { extractDproductRawSearchText } from './v0-raw-search-text'
import { mapDpmatchRowToMeiliDoc, type DpmatchIndexRow } from './v0-search-document'

function baseRow(overrides: Partial<DpmatchIndexRow> = {}): DpmatchIndexRow {
  return {
    id: 1,
    stock_code: 'AKD 44-3535',
    stock_name: 'Piston kit',
    brand: 'AKD',
    part_no: '44-3535',
    barcode_1: null,
    barcode_2: null,
    barcode_3: null,
    title: 'AKD piston',
    model: '44-3535-08-100',
    ref_no: 'GOETZE 8771693100, MAHLE 011 75 02',
    normalized_name: null,
    dinamik_price: '100',
    dinamik_stock_qty: 1,
    pt_price: null,
    image_url: null,
    manufacturer_name: 'AKD',
    matched_brand: 'AKD',
    dinamik_raw: { marka: 'AKD', stokAdi: 'Piston' },
    brand_logo_url: null,
    ...overrides
  }
}

describe('extractDproductRawSearchText', () => {
  it('joins known raw JSON string fields', () => {
    const text = extractDproductRawSearchText({
      marka: 'MAHLE',
      stokAdi: 'KOL YATAK',
      stokKodu: 'MAHLE 029PS18146025',
      barkod3: '4009026526224'
    })
    expect(text.includes('MAHLE')).toBe(true)
    expect(text.includes('KOL YATAK')).toBe(true)
    expect(text.includes('4009026526224')).toBe(true)
  })
})

describe('mapDpmatchRowToMeiliDoc', () => {
  it('uses matched brand for brandName and facet field', () => {
    const doc = mapDpmatchRowToMeiliDoc(
      baseRow({
        brand: 'MAHLE FILTRE',
        manufacturer_name: 'BEHR MAHLE',
        matched_brand: 'BEHR MAHLE'
      })
    )
    expect(doc.brandName).toBe('BEHR MAHLE')
  })

  it('does not put cross-ref ref_no into oemCodes', () => {
    const doc = mapDpmatchRowToMeiliDoc(baseRow())
    expect(doc.refNo?.includes('MAHLE')).toBe(true)
    expect(doc.oemCodes.some((code) => code.includes('MAHLE'))).toBe(false)
  })

  it('indexes title, model, sku, and rawText as separate fields', () => {
    const doc = mapDpmatchRowToMeiliDoc(baseRow())
    expect(doc.title).toBe('AKD piston')
    expect(doc.model).toBe('44-3535-08-100')
    expect(doc.sku).toBe('AKD 44-3535')
    expect(doc.rawText?.includes('AKD')).toBe(true)
  })
})
