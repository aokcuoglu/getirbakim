import { describe, expect, it } from 'bun:test'
import { parseArticles } from './tecdoc-catalog'

// Servisin gerçek yanıt biçiminden kısaltılmış örnek (MAHLE TX 10 76D).
const PAYLOAD = {
  totalMatchingArticles: 1,
  articles: [
    {
      articleNumber: 'TX 10 76D',
      mfrName: 'MAHLE',
      genericArticles: [{ genericArticleDescription: 'Thermostat, coolant' }],
      oemNumbers: [
        { articleNumber: '1 544 097', mfrName: 'VOLVO' },
        { articleNumber: '1 544 297', mfrName: 'VOLVO' },
        { articleNumber: '30637912', mfrName: 'FORD' }
      ]
    }
  ]
}

describe('parseArticles', () => {
  // Katalogdaki kod bitişik ("TX1076D"), serviste boşluklu ("TX 10 76D").
  it('boşluklu servis numarasını bitişik katalog numarasıyla eşler', () => {
    const result = parseArticles(PAYLOAD, 'TX1076D')
    expect(result.matched).toBe(true)
    expect(result.description).toBe('Thermostat, coolant')
    expect(result.oems).toEqual([
      { brand: 'VOLVO', code: '1 544 097' },
      { brand: 'VOLVO', code: '1 544 297' },
      { brand: 'FORD', code: '30637912' }
    ])
  })

  // Servis prefix_or_suffix ile arıyor: "LX95" sorgusu "LX 952" döndürür.
  // Birebir karşılaştırma olmasa başka parçanın OEM'leri bu ürüne yazılırdı.
  it('bulanık sonucun OEM\'lerini almaz', () => {
    const payload = {
      articles: [
        {
          articleNumber: 'LX 952',
          mfrName: 'MAHLE',
          oemNumbers: [{ articleNumber: 'ESR2102', mfrName: 'LAND ROVER' }]
        }
      ]
    }
    const result = parseArticles(payload, 'LX95')
    expect(result.matched).toBe(false)
    expect(result.oems).toEqual([])
  })

  it('aynı numarayı hem MAHLE hem KNECHT döndürdüğünde tekrarlamaz', () => {
    const payload = {
      articles: [
        {
          articleNumber: 'LX 2907',
          mfrName: 'KNECHT',
          oemNumbers: [{ articleNumber: '13717797465', mfrName: 'BMW' }]
        },
        {
          articleNumber: 'LX 2907',
          mfrName: 'MAHLE',
          oemNumbers: [{ articleNumber: '13717797465', mfrName: 'BMW' }]
        }
      ]
    }
    expect(parseArticles(payload, 'LX2907').oems).toEqual([
      { brand: 'BMW', code: '13717797465' }
    ])
  })

  it('parçanın kendi numarasını OEM saymaz', () => {
    const payload = {
      articles: [
        {
          articleNumber: '001 01 G0',
          oemNumbers: [
            { articleNumber: '00101G0', mfrName: 'MAHLE' },
            { articleNumber: '55284051', mfrName: 'FIAT' }
          ]
        }
      ]
    }
    expect(parseArticles(payload, '00101G0').oems).toEqual([
      { brand: 'FIAT', code: '55284051' }
    ])
  })

  it('OEM listesi boş olan üründe eşleşmeyi yine bildirir', () => {
    const payload = { articles: [{ articleNumber: '001 01 01', oemNumbers: [] }] }
    const result = parseArticles(payload, '0010101')
    expect(result.matched).toBe(true)
    expect(result.oems).toEqual([])
  })

  it('bozuk yanıtta çakmaz', () => {
    expect(parseArticles(null, '123').matched).toBe(false)
    expect(parseArticles({ articles: 'nope' }, '123').matched).toBe(false)
    expect(parseArticles({ articles: [{ articleNumber: '123' }] }, '123').oems).toEqual([])
  })
})
