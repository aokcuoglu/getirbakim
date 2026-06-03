import { describe, expect, it } from 'bun:test'
import {
  buildBasbugCodeSignals,
  buildDpmatchCodeSignals
} from './product-code-signals'

describe('buildDpmatchCodeSignals', () => {
  it('adds ptdrk ref_no tokens as derived code signals', () => {
    const signals = buildDpmatchCodeSignals({
      matchId: 42,
      dnmkProductId: BigInt(1001),
      ptdrkProductId: 77,
      dinamikPartNo: '0 445 110 376',
      dinamikBarcode1: '8691234567890',
      dinamikBarcode2: null,
      dinamikBarcode3: null,
      dinamikStockCode: 'BOSCH 0445110376',
      ptRefNo: 'VAG12345, 8677309380; 1K0 919 087 A',
      ptPartNo: 'PT-ABC',
      ptSku: 'SKU-1'
    })

    const normalizedCodes = signals.map((signal) => signal.normalizedCode)
    expect(normalizedCodes.includes('VAG12345')).toBe(true)
    expect(normalizedCodes.includes('8677309380')).toBe(true)
    expect(normalizedCodes.includes('1K0919087A')).toBe(true)
    expect(
      signals.find((signal) => signal.rawCode === '8677309380')?.codeKind
    ).toBe('EAN')
  })

  it('keeps Dinamik and ParcaTedarik origins traceable', () => {
    const signals = buildDpmatchCodeSignals({
      matchId: 7,
      dnmkProductId: BigInt(10),
      ptdrkProductId: 20,
      dinamikPartNo: 'A 651 090 04 70',
      ptRefNo: 'MAHLE 0117502'
    })

    expect(signals.some((signal) => signal.origin === 'dnmk.part_no')).toBe(true)
    expect(signals.some((signal) => signal.origin === 'ptdrk.ref_no')).toBe(true)
    expect(
      signals.every((signal) => signal.evidence.productMappingId === 7)
    ).toBe(true)
  })
})

describe('buildBasbugCodeSignals', () => {
  it('builds Başbuğ OEM and material code signals without mutating raw columns', () => {
    const signals = buildBasbugCodeSignals({
      bsbgProductId: BigInt(55),
      oemNo: 'A6510900470',
      partNo: '6510900470',
      malzemeNo: 'BOEM A6510900470'
    })

    expect(signals).toHaveLength(3)
    expect(signals.map((signal) => signal.origin)).toEqual([
      'bsbg.oem_no',
      'bsbg.part_no',
      'bsbg.malzeme_no'
    ])
    expect(signals[0].codeKind).toBe('OEM')
  })
})
