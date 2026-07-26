import { describe, expect, it } from 'bun:test'
import { createBrandResolver, vocabKey } from './oem-brand-vocab'

// Katalogda gerçekten bulunan değerlerden bir kesit.
const VOCAB = [
  'VW',
  'AUDI',
  'MERCEDES-BENZ',
  'CITROËN',
  'SKODA',
  'VAUXHALL',
  'SSANGYONG',
  'ALPINA',
  'DAIMLER',
  'RAM',
  'IVECO',
  'MAN',
  'FORD',
  'HOLDEN'
]

describe('vocabKey', () => {
  it('aksan ve ayraçları eler', () => {
    expect(vocabKey('Citroën')).toBe('CITROEN')
    expect(vocabKey('Mercedes-Benz')).toBe('MERCEDESBENZ')
    expect(vocabKey('Škoda')).toBe('SKODA')
  })
})

describe('createBrandResolver', () => {
  const resolve = createBrandResolver(VOCAB)

  it('birebir eşleşmeyi sözlükteki yazımıyla döner', () => {
    expect(resolve('Citroën')).toBe('CITROËN')
    expect(resolve('Mercedes-Benz')).toBe('MERCEDES-BENZ')
    expect(resolve('Škoda')).toBe('SKODA')
  })

  it('parantezli soneki atarak çözer', () => {
    expect(resolve('IVECO (LCV)')).toBe('IVECO')
    expect(resolve('MAN (LCV)')).toBe('MAN')
    expect(resolve('Ford (North America)')).toBe('FORD')
    expect(resolve('Holden (GM)')).toBe('HOLDEN')
  })

  it('gövde tutmazsa parantez içine düşer', () => {
    expect(resolve('Volkswagen (VW)')).toBe('VW')
    expect(resolve('KGM (SsangYong)')).toBe('SSANGYONG')
  })

  // Parantez içi ÜST markayı ya da ortak girişimi gösterebilir; gövde
  // sözlükte varsa ona öncelik verilmeli, yoksa Alpina BMW'ye dönüşürdü.
  it('gövde varken parantez içindeki üst markaya sapmaz', () => {
    expect(resolve('Alpina (BMW)')).toBe('ALPINA')
    expect(resolve('Daimler (Jaguar)')).toBe('DAIMLER')
    expect(resolve('RAM (Chrysler)')).toBe('RAM')
  })

  it('sözlükte olmayan markayı büyük harfe çevirip korur', () => {
    expect(resolve('Leapmotor')).toBe('LEAPMOTOR')
    expect(resolve('togg')).toBe('TOGG')
  })

  it('boş girdide boş döner', () => {
    expect(resolve('   ')).toBe('')
  })
})
