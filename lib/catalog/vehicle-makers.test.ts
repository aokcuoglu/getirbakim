import { describe, it, expect } from 'bun:test'
import { inferVehicleMaker, inferVehicleMakers, sameMakerFamily } from './vehicle-makers'

describe('inferVehicleMakers', () => {
  it('marka adını doğrudan bulur', () => {
    expect(inferVehicleMakers('Alfa Romeo 166 Alternatör Gergi Rulmanı')).toContain('ALFA ROMEO')
  })

  it('model adından markayı çıkarır', () => {
    expect(inferVehicleMakers('ALTERNATOR GERGI RULMANI ASTRA G / H VECTRA C')).toContain('OPEL')
  })

  it('birden çok markayı birlikte döndürür', () => {
    const makers = inferVehicleMakers('TRIGER SETI ALFA ROMEO 147 FIAT BRAVO CROMA')
    expect(makers).toContain('ALFA ROMEO')
    expect(makers).toContain('FIAT')
  })

  it('"RULMAN" içindeki "MAN"ı marka saymaz', () => {
    expect(inferVehicleMakers('Uno Alternatör Gergi Rulmanı Aba Rulman')).toEqual(['FIAT'])
  })

  it('MERCEDES yazımını MERCEDES-BENZ olarak normalize eder', () => {
    expect(inferVehicleMaker('ALTERNATOR GERGI KASNAGI MERCEDES ACTROS')).toBe('MERCEDES-BENZ')
  })

  it('araç bilgisi yoksa boş döner', () => {
    expect(inferVehicleMakers('ABA 25100603')).toEqual([])
  })
})

describe('sameMakerFamily', () => {
  it('aynı markayı eşler', () => {
    expect(sameMakerFamily('FIAT', 'FIAT')).toBe(true)
  })

  it('OEM paylaşan grubu eşler (Fiat grubu)', () => {
    expect(sameMakerFamily('FIAT', 'ALFA ROMEO')).toBe(true)
    expect(sameMakerFamily('LANCIA', 'ABARTH')).toBe(true)
  })

  it('VAG grubunu eşler', () => {
    expect(sameMakerFamily('AUDI', 'SKODA')).toBe(true)
  })

  it('ilgisiz markaları eşlemez', () => {
    expect(sameMakerFamily('FIAT', 'RENAULT')).toBe(false)
    expect(sameMakerFamily('BMW', 'OPEL')).toBe(false)
  })
})
