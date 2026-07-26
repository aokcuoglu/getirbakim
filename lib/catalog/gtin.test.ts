import { describe, expect, it } from 'bun:test'
import { collectValidGtins, isValidGtin, normalizeGtin } from './gtin'

// Gerçek barkodlar: katalogdaki ürünlerden ve REPXPERT yanıtlarından alındı.
const GERCEK = [
  '4027816010920', // FEBI 01092 (REPXPERT ürün sayfası)
  '4005108599292', // Schaeffler LuK 600 0068 00
  '4005108222947' // Schaeffler LuK 624 3078 00
]

describe('isValidGtin', () => {
  it('gerçek EAN-13 kodlarını kabul eder', () => {
    for (const code of GERCEK) expect(isValidGtin(code)).toBe(true)
  })

  it('ayraç olarak boşluk ve tireyi kabul eder', () => {
    expect(isValidGtin('4027816 010920')).toBe(true)
    expect(isValidGtin('4027816-010920')).toBe(true)
    expect(isValidGtin('  4027816010920  ')).toBe(true)
  })

  it('kontrol hanesi tutmayan kodu reddeder', () => {
    // Son hane 0 yerine 1: biçim doğru, checksum yanlış.
    expect(isValidGtin('4027816010921')).toBe(false)
  })

  it('parça numarasını barkod sanmaz', () => {
    // Prod'da bozuk aktarımın yazdığı gerçek değerler.
    expect(isValidGtin('10PK1342')).toBe(false)
    expect(isValidGtin('ABA-10PK1342')).toBe(false)
    expect(isValidGtin('TL427')).toBe(false)
  })

  it('yer tutucu ve boş değerleri reddeder', () => {
    expect(isValidGtin('0')).toBe(false)
    expect(isValidGtin('0000000000000')).toBe(false)
    expect(isValidGtin('')).toBe(false)
    expect(isValidGtin('   ')).toBe(false)
  })

  it('GTIN olmayan uzunlukları reddeder', () => {
    expect(isValidGtin('123')).toBe(false)
    expect(isValidGtin('1234567890')).toBe(false) // 10 hane
    expect(isValidGtin('123456789012345')).toBe(false) // 15 hane
  })

  it('EAN-8, UPC-12 ve ITF-14"ü kabul eder', () => {
    expect(isValidGtin('96385074')).toBe(true) // EAN-8
    expect(isValidGtin('036000291452')).toBe(true) // UPC-A
    expect(isValidGtin('10614141000415')).toBe(true) // ITF-14
  })
})

describe('normalizeGtin', () => {
  it('ayraçları atar, rakamları bırakır', () => {
    expect(normalizeGtin('4027816-010920')).toBe('4027816010920')
  })

  it('harf içeren değeri rakamlarına indirgemez', () => {
    // Kritik: indirgeseydi "ABA-10PK1342" → "101342" olur, uzunluk tutarsa
    // parça numarası barkod diye geçerdi.
    expect(normalizeGtin('ABA-10PK1342')).toBeNull()
  })
})

describe('collectValidGtins', () => {
  it('yalnız geçerlileri, tekrarsız ve normalize döner', () => {
    expect(
      collectValidGtins(['4027816010920', '4027816-010920', '10PK1342', '0', GERCEK[1]])
    ).toEqual(['4027816010920', '4005108599292'])
  })

  it('hiçbiri geçerli değilse boş döner', () => {
    expect(collectValidGtins(['ABA-1', '0', ''])).toEqual([])
  })
})
