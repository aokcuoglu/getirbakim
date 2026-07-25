import { describe, it, expect } from 'bun:test'
import {
  buildSeoProductName,
  isPlaceholderName,
  mergeWebTitles,
  stripVendorCodes
} from './seo-name'

const ABA = 'A.B.A.'

function seo(rawName: string, partNo?: string) {
  return buildSeoProductName({ brandLabel: ABA, rawName, partNo })
}

describe('buildSeoProductName', () => {
  it('marka etiketini başa ekler ve Türkçe yazımı düzeltir', () => {
    expect(seo('ALTERNATOR GERGI RULMANI CLIO KANGOO MEGANE 1.4', '25100411')).toBe(
      'A.B.A. Alternatör Gergi Rulmanı Clio Kangoo Megane 1.4'
    )
  })

  it('ham addaki marka tekrarını atar', () => {
    expect(seo('ABA ALTERNATOR KAYISI', '10PK1342')).toBe('A.B.A. Alternatör Kayışı')
  })

  it('araç markası kısaltmalarını büyük bırakır', () => {
    expect(seo('GERGI RULMANI BMW M47N M57N E87 E90 E92')).toBe(
      'A.B.A. Gergi Rulmanı BMW M47N M57N E87 E90 E92'
    )
  })

  it('ölçü token’ını küçük x ile normalize eder', () => {
    expect(seo('ALTERNATOR GERGI RULMANI ASTRA G 17X63X22')).toBe(
      'A.B.A. Alternatör Gergi Rulmanı Astra G 17x63x22'
    )
  })

  it('motor hacminde virgülü noktaya çevirir', () => {
    expect(seo('EKSANTRIK GERGI RULMANI DOBLO 1,4')).toBe(
      'A.B.A. Eksantrik Gergi Rulmanı Doblo 1.4'
    )
  })

  it('eğik çizgi çevresindeki boşlukları toplar, parantezi korur', () => {
    expect(seo('ALTERNATOR GERGI KASNAGI KOMPLE MERCEDES ACTROS 03> (OM541940)')).toBe(
      'A.B.A. Alternatör Gergi Kasnağı Komple Mercedes Actros 03> (OM541940)'
    )
  })

  it('yalnız marka + parça no olan yer tutucuda null döner', () => {
    expect(seo('ABA 25100603', '25100603')).toBeNull()
  })

  it('boş adda null döner', () => {
    expect(seo('   ', '25100603')).toBeNull()
  })

  it('istenirse parça numarasını sona ekler', () => {
    expect(
      buildSeoProductName({
        brandLabel: ABA,
        rawName: 'V KAYIS GERGI KUTUGU BMW E60',
        partNo: '25007031',
        includePartNo: true
      })
    ).toBe('A.B.A. V Kayış Gergi Kütüğü BMW E60 25007031')
  })

  it('uzun başlığı kelime sınırında keser', () => {
    const out = buildSeoProductName({
      brandLabel: ABA,
      rawName:
        'DEVIRDAIMLI EKSANTRIK RULMAN KITI TRIGER SETI ALFA ROMEO 146 147 156 159 FIAT BRAVA BRAVO CROMA DOBLO',
      partNo: '25100999',
      maxLength: 60
    })
    expect(out!.length <= 60).toBe(true)
    expect(out!.endsWith(' ')).toBe(false)
    expect(out!.startsWith('A.B.A. Devirdaimli Eksantrik Rulman Kiti')).toBe(true)
  })

  it('dizel kısaltmasını açar', () => {
    expect(seo('KANALLI KAYIS MEGANE 1.9 DZL')).toBe('A.B.A. Kanallı Kayış Megane 1.9 Dizel')
  })
})

describe('isPlaceholderName', () => {
  it('marka + parça no birleşimini yer tutucu sayar', () => {
    expect(isPlaceholderName('ABA 25100603', 'ABA', '25100603')).toBe(true)
  })

  it('sadece parça no da yer tutucudur', () => {
    expect(isPlaceholderName('25100603', 'ABA', '25100603')).toBe(true)
  })

  it('açıklamalı adı yer tutucu saymaz', () => {
    expect(isPlaceholderName('ALTERNATOR GERGI RULMANI ASTRA G', 'ABA', '25006322')).toBe(false)
  })
})

describe('mergeWebTitles', () => {
  it('ortak parça tipini korur, araçları birleştirir', () => {
    expect(
      mergeWebTitles([
        'Brava Triger Gergi Rulmanı 1.6 16V',
        'Palio Triger Gergi Rulmanı 1.6',
        'Stilo Triger Gergi Rulmanı 1.6 16V'
      ])
    ).toBe('Triger Gergi Rulmanı Brava Palio Stilo 1.6 16V')
  })

  it('aynı aracın farklı modellerini tek ada toplar', () => {
    expect(
      mergeWebTitles([
        'Alfa Romeo 156 Alternatör Gergi Rulmanı 2.5',
        'Alfa Romeo 166 Alternatör Gergi Rulmanı 3.0'
      ])
    ).toBe('Alternatör Gergi Rulmanı Alfa Romeo 156 166 2.5 3.0')
  })

  it('tek başlıkta da çalışır', () => {
    expect(mergeWebTitles(['Uno Alternatör Gergi Rulmanı'])).toBe('Alternatör Gergi Rulmanı Uno')
  })

  it('parça tipi bulunamayan başlıklarda null döner', () => {
    expect(mergeWebTitles(['Bir Şey', 'Başka Şey'])).toBeNull()
  })

  it('birleşik ad SEO başlığına dönüştürülebilir', () => {
    const merged = mergeWebTitles([
      'Brava Triger Gergi Rulmanı 1.6 16V',
      'Palio Triger Gergi Rulmanı 1.6'
    ])!
    expect(buildSeoProductName({ brandLabel: 'A.B.A.', rawName: merged, partNo: '25105842' })).toBe(
      'A.B.A. Triger Gergi Rulmanı Brava Palio 1.6 16V'
    )
  })
})

describe('stripVendorCodes', () => {
  it('tireli satıcı kodunu atar', () => {
    expect(stripVendorCodes('Punto Triger Gergi Rulmanı SUS-BG0040-02')).toBe(
      'Punto Triger Gergi Rulmanı'
    )
  })

  it('rakip marka stok kodlarını atar', () => {
    expect(stripVendorCodes('Trafic 2 Master 2.5Dci ATB2128 KD45562 VKM26503')).toBe(
      'Trafic 2 Master 2.5Dci'
    )
  })

  it('sonek harfli OEM numaralarını atar', () => {
    expect(stripVendorCodes('Clio 4 1.2 16V 130701564R 130705295R')).toBe('Clio 4 1.2 16V')
  })

  it('motor ve model bilgisini korur', () => {
    expect(stripVendorCodes('Megane 1 1.9Tdi 16V E90 M47N')).toBe('Megane 1 1.9Tdi 16V E90 M47N')
  })
})
