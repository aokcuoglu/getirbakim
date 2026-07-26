import { describe, expect, it } from 'bun:test'
import { parseArticles, searchUrl } from './bilstein'

// Servisin gerçek yanıt biçiminden kısaltılmış örnek.
const PAYLOAD = {
  data: [
    {
      id: '28779',
      attributes: {
        bgBrand: 'FEBI',
        articleDescription: 'V-Ribbed Belt',
        oeNumbers: [
          { make: 'Hyundai', numbers: ['97713-22260'] },
          { make: 'Toyota', numbers: ['90916-02265', '90916-02341'] }
        ]
      }
    },
    {
      // Bulanık sonuç: aranan numara değil, OEM'leri başka parçaya ait.
      id: '99999',
      attributes: {
        bgBrand: 'FEBI',
        articleDescription: 'Wrong Part',
        oeNumbers: [{ make: 'BMW', numbers: ['11111111'] }]
      }
    }
  ]
}

describe('parseArticles', () => {
  it('yalnız numarası birebir eşleşen kaydın OEM\'lerini alır', () => {
    const result = parseArticles(PAYLOAD, '28779')
    expect(result.matched).toBe(true)
    expect(result.description).toBe('V-Ribbed Belt')
    expect(result.oems).toEqual([
      { brand: 'Hyundai', code: '97713-22260' },
      { brand: 'Toyota', code: '90916-02265' },
      { brand: 'Toyota', code: '90916-02341' }
    ])
  })

  // SWAG numaraları katalogda bitişik, serviste boşluklu yazılıyor.
  it('boşluklu servis numarasını bitişik katalog numarasıyla eşler', () => {
    const payload = {
      data: [
        {
          id: '91 94 1894',
          attributes: {
            bgBrand: 'SWAG',
            articleDescription: 'Control Arm',
            oeNumbers: [{ make: 'Audi', numbers: ['8E0407151R'] }]
          }
        }
      ]
    }
    const result = parseArticles(payload, '91941894')
    expect(result.matched).toBe(true)
    expect(result.oems).toEqual([{ brand: 'Audi', code: '8E0407151R' }])
  })

  it('eşleşme yoksa boş sonuç döner', () => {
    const result = parseArticles(PAYLOAD, '12345678')
    expect(result.matched).toBe(false)
    expect(result.oems).toEqual([])
  })

  it('parçanın kendi numarasını OEM saymaz', () => {
    const payload = {
      data: [
        {
          id: '28779',
          attributes: {
            bgBrand: 'FEBI',
            articleDescription: 'Belt',
            oeNumbers: [{ make: 'Toyota', numbers: ['28779', '90916-02265'] }]
          }
        }
      ]
    }
    const result = parseArticles(payload, '28779')
    expect(result.oems).toEqual([{ brand: 'Toyota', code: '90916-02265' }])
  })

  it('aynı marka+kod ikilisini tekrarlamaz', () => {
    const payload = {
      data: [
        {
          id: '1',
          attributes: {
            oeNumbers: [
              { make: 'Fiat', numbers: ['55284051', '55284051'] },
              { make: 'Fiat', numbers: ['55284051'] }
            ]
          }
        }
      ]
    }
    expect(parseArticles(payload, '1').oems).toEqual([{ brand: 'Fiat', code: '55284051' }])
  })

  it('bozuk yanıtta çakmaz', () => {
    expect(parseArticles(null, '123').matched).toBe(false)
    expect(parseArticles({ data: 'nope' }, '123').matched).toBe(false)
    expect(parseArticles({ data: [{ id: '123' }] }, '123').oems).toEqual([])
  })
})

describe('searchUrl', () => {
  it('JSON:API sorgu parametrelerini kodlar', () => {
    const url = searchUrl('BLUE_PRINT', 'ADC47202', 'CAR')
    expect(url.includes('filter%5Bphrase%5D=ADC47202')).toBe(true)
    expect(url.includes('filter%5Bbrands%5D=BLUE_PRINT')).toBe(true)
    expect(url.includes('filter%5BvehicleType%5D=CAR')).toBe(true)
  })
})
