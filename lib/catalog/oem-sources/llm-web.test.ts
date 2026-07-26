import { describe, expect, it } from 'bun:test'
import { extractReport, keepVerifiable } from './llm-web'

describe('extractReport', () => {
  it('report_oems çağrısını okur', () => {
    const report = extractReport([
      { type: 'text', text: 'Aramayı yaptım.' },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'report_oems',
        input: {
          found: true,
          partDescription: 'V kayışı',
          oems: [{ code: '21602741', vehicleMake: 'Volvo', sourceUrl: 'https://x.example/a' }]
        }
      }
    ] as never)
    expect(report?.found).toBe(true)
    expect(report?.partDescription).toBe('V kayışı')
    expect(report?.oems).toHaveLength(1)
  })

  // Model aracı çağırmayıp yalnız metin yazdıysa ortada yapısal bir iddia
  // yoktur; serbest metinden numara ayıklamak tam da kaçınmak istediğimiz şey.
  it('araç çağrısı yoksa null döner', () => {
    const report = extractReport([
      { type: 'text', text: 'OEM numarası muhtemelen 12345678 olabilir.' }
    ] as never)
    expect(report).toBeNull()
  })

  it('eksik alanlı satırları atar', () => {
    const report = extractReport([
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'report_oems',
        input: {
          found: true,
          partDescription: '',
          oems: [
            { code: '111', vehicleMake: 'X' },
            { code: '222', vehicleMake: 'Y', sourceUrl: 'https://x.example/b' }
          ]
        }
      }
    ] as never)
    expect(report?.oems).toEqual([
      { code: '222', vehicleMake: 'Y', sourceUrl: 'https://x.example/b' }
    ])
  })
})

describe('keepVerifiable', () => {
  const url = 'https://ornek.example/urun'

  it('kaynağı olmayan satırı eler', () => {
    const kept = keepVerifiable(
      [
        { code: '21602741', vehicleMake: 'Volvo', sourceUrl: url },
        { code: '7421314460', vehicleMake: 'Renault', sourceUrl: 'kaynak yok' }
      ],
      '10PK1520'
    )
    expect(kept).toEqual([{ brand: 'Volvo', code: '21602741' }])
  })

  it('ürünün kendi numarasını eler', () => {
    const kept = keepVerifiable(
      [{ code: '10PK1520', vehicleMake: '', sourceUrl: url }],
      '10PK1520'
    )
    expect(kept).toEqual([])
  })

  it('kısa ya da rakamsız kodu eler', () => {
    const kept = keepVerifiable(
      [
        { code: 'ABC', vehicleMake: '', sourceUrl: url },
        { code: 'ABCDEFGH', vehicleMake: '', sourceUrl: url }
      ],
      '999'
    )
    expect(kept).toEqual([])
  })

  it('tekrarlayan kodu bir kez alır ve marka boşsa null yazar', () => {
    const kept = keepVerifiable(
      [
        { code: '55284051', vehicleMake: '', sourceUrl: url },
        { code: '55-284-051', vehicleMake: 'Fiat', sourceUrl: url }
      ],
      '999'
    )
    expect(kept).toEqual([{ brand: null, code: '55284051' }])
  })
})
