import { describe, expect, it } from 'bun:test'
import {
  createRepxpertSource,
  encodeProductCode,
  oeNumbersPath,
  parseOeNumbers,
  type RepxpertTransport
} from './repxpert'
import { searchPath } from './repxpert-search'

// Servisin gerçek yanıtından kısaltılmış örnek (DELPHI TL427 → SEAT).
const PAYLOAD = {
  oenumbers: [
    {
      manufacturer: { name: 'SEAT' },
      numbers: [
        { exchangeability: 'Değiştirilebilir', number: '191 422 803', normalizedNumber: '191422803' },
        // Aynı numaranın bitişik yazılışı — tek satıra inmeli.
        { number: '191422803', normalizedNumber: '191422803' },
        { number: '191 422 803 A', normalizedNumber: '191422803a' }
      ]
    },
    {
      manufacturer: { name: 'VW' },
      // Parçanın kendi numarası OEM sayılmaz.
      numbers: [{ number: 'TL427' }, { number: '357422803' }]
    }
  ]
}

function transportFor(responses: Record<string, { status: number; body?: unknown }>): {
  transport: RepxpertTransport
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    transport: {
      async get(path) {
        calls.push(path)
        const hit = responses[path]
        if (!hit) throw new Error(`beklenmeyen yol: ${path}`)
        return { status: hit.status, body: hit.body ?? null }
      }
    }
  }
}

describe('encodeProductCode', () => {
  it('TecDoc marka id + parça numarasını sitenin kod biçimine çevirir', () => {
    // Sitenin kendi ürettiği kodlar: gerçek sayfalardan alındı.
    expect(encodeProductCode(101, '01092')).toBe('Ext-TA-MTAxOjAxMDky')
    expect(encodeProductCode(4997, '10PK1520')).toBe('Ext-TA-NDk5NzoxMFBLMTUyMA')
    expect(encodeProductCode(21, '564099')).toBe('Ext-TA-MjE6NTY0MDk5')
  })

  it('numaranın başındaki/sonundaki boşluğu atar', () => {
    expect(encodeProductCode(101, '  01092 ')).toBe(encodeProductCode(101, '01092'))
  })
})

describe('parseOeNumbers', () => {
  it('üretici adıyla birlikte OEM listesini çıkarır', () => {
    expect(parseOeNumbers(PAYLOAD, 'TL427')).toEqual([
      { brand: 'SEAT', code: '191 422 803' },
      { brand: 'SEAT', code: '191 422 803 A' },
      { brand: 'VW', code: '357422803' }
    ])
  })

  it('parçanın kendi numarasını OEM saymaz', () => {
    const codes = parseOeNumbers(PAYLOAD, 'TL427').map((o) => o.code)
    expect(codes.includes('TL427')).toBe(false)
  })

  it('boş/bozuk yanıtta boş liste döner', () => {
    expect(parseOeNumbers(null, 'X')).toEqual([])
    expect(parseOeNumbers({}, 'X')).toEqual([])
    expect(parseOeNumbers({ oenumbers: [] }, 'X')).toEqual([])
  })
})

describe('createRepxpertSource', () => {
  const brandIds = { DELPHI: 89, VALEO: 21 }

  it('yalnız haritada olan markaları kapsar', () => {
    const { transport } = transportFor({})
    const source = createRepxpertSource({ transport, brandIds })
    expect(source.supports('DELPHI')).toBe(true)
    expect(source.supports('delphi')).toBe(true)
    expect(source.supports('KRAFTVOLL')).toBe(false)
    expect(source.brands().sort()).toEqual(['DELPHI', 'VALEO'])
  })

  it('ürün başına tek istek atar ve OEM"leri döner', async () => {
    const path = oeNumbersPath('Ext-TA-ODk6VEw0Mjc')
    const { transport, calls } = transportFor({ [path]: { status: 200, body: PAYLOAD } })
    const source = createRepxpertSource({ transport, brandIds })

    const result = await source.lookup('DELPHI', 'TL427')

    expect(calls).toEqual([path])
    expect(result.matched).toBe(true)
    expect(result.oems).toHaveLength(3)
    expect(result.sourceUrl).toBe('https://www.repxpert.com.tr/tr/catalog/p-Ext-TA-ODk6VEw0Mjc')
  })

  it('400/404 sonuçsuz sorgudur — hata değil', async () => {
    const path = oeNumbersPath('Ext-TA-ODk6WVlZ')
    // Kod tutmayınca yazılış farkı olabilir diye aramaya bakılır; o da boşsa
    // sonuç yoktur.
    const { transport } = transportFor({
      [path]: { status: 400 },
      [searchPath('YYY')]: { status: 200, body: { products: [] } }
    })
    const source = createRepxpertSource({ transport, brandIds })

    const result = await source.lookup('DELPHI', 'YYY')
    expect(result.matched).toBe(false)
    expect(result.oems).toEqual([])
  })

  /** `expect(...).rejects` bu sürümde tiplenmiyor; hata elle yakalanır. */
  async function messageOf(promise: Promise<unknown>): Promise<string> {
    try {
      await promise
      return ''
    } catch (e) {
      return (e as Error).message
    }
  }

  it('sunucu hatasında fırlatır — sürücü yeniden dener', async () => {
    const path = oeNumbersPath('Ext-TA-ODk6VEw0Mjc')
    const { transport } = transportFor({ [path]: { status: 503 } })
    const source = createRepxpertSource({ transport, brandIds })
    expect((await messageOf(source.lookup('DELPHI', 'TL427'))).includes('503')).toBe(true)
  })

  it('kapsamadığı markada fırlatır', async () => {
    const { transport } = transportFor({})
    const source = createRepxpertSource({ transport, brandIds })
    expect((await messageOf(source.lookup('KRAFTVOLL', '123'))).includes('kapsamıyor')).toBe(true)
  })
})

/**
 * Katalogdaki numara TecDoc'taki YAZILIŞLA tutmadığında (BOSCH "0445110274" ↔
 * "0 445 110 274") doğrudan kod 400 döner. Bu markaların tamamı sessizce boş
 * dönüyordu; arama ucu doğru yazılışı ve kodu veriyor.
 */
describe('createRepxpertSource · yazılış tutmadığında arama yedeği', () => {
  const brandIds = { BOSCH: 30, VICTORREINZ: 9 }
  /** Boşluklu yazılan numaranın kendi kaydı — kendi numarası OEM sayılmamalı. */
  const BOSCH_OES = {
    oenumbers: [
      {
        manufacturer: { name: 'VW' },
        numbers: [{ number: '03L 130 277 J' }, { number: '0 445 110 274' }]
      }
    ]
  }
  const SEARCH_PAYLOAD = {
    products: [
      {
        code: 'Ext-TA-MzA6MCA0NDUgMTEwIDI3NA',
        brand: { name: 'BOSCH' },
        catalogArticleNumber: '0 445 110 274'
      }
    ]
  }

  it('doğrudan kod 400 dönünce aramadan bulduğu kodla OEM"leri çeker', async () => {
    const direct = oeNumbersPath(encodeProductCode(30, '0445110274'))
    const search = searchPath('0445110274')
    const viaSearch = oeNumbersPath('Ext-TA-MzA6MCA0NDUgMTEwIDI3NA')
    const { transport, calls } = transportFor({
      [direct]: { status: 400 },
      [search]: { status: 200, body: SEARCH_PAYLOAD },
      [viaSearch]: { status: 200, body: BOSCH_OES }
    })
    const source = createRepxpertSource({ transport, brandIds })

    const result = await source.lookup('BOSCH', '0445110274')

    expect(calls).toEqual([direct, search, viaSearch])
    expect(result.matched).toBe(true)
    // Ürünün kendi numarası ("0 445 110 274") elenir, geriye OEM kalır.
    expect(result.oems).toEqual([{ brand: 'VW', code: '03L 130 277 J' }])
    // Kanıt adresi gerçekten bakılan ürünü göstermeli.
    expect(result.sourceUrl.endsWith('Ext-TA-MzA6MCA0NDUgMTEwIDI3NA')).toBe(true)
  })

  it('marka önekli numarayı aramaya gitmeden düzeltir', async () => {
    const raw = oeNumbersPath(encodeProductCode(9, 'REINZ 01-31555-01'))
    const stripped = oeNumbersPath(encodeProductCode(9, '01-31555-01'))
    const { transport, calls } = transportFor({
      [raw]: { status: 400 },
      [stripped]: { status: 200, body: PAYLOAD }
    })
    const source = createRepxpertSource({ transport, brandIds })

    const result = await source.lookup('VICTORREINZ', 'REINZ 01-31555-01')

    expect(calls).toEqual([raw, stripped])
    expect(result.matched).toBe(true)
  })

  it('aramada da bulunamazsa sonuçsuz sorgudur — hata değil', async () => {
    const direct = oeNumbersPath(encodeProductCode(30, '0445110274'))
    const { transport } = transportFor({
      [direct]: { status: 400 },
      [searchPath('0445110274')]: { status: 200, body: { products: [] } }
    })
    const source = createRepxpertSource({ transport, brandIds })

    const result = await source.lookup('BOSCH', '0445110274')
    expect(result.matched).toBe(false)
    expect(result.oems).toEqual([])
  })

  it('bir markada arama işe yaradıysa sonraki üründe doğrudan kodu denemez', async () => {
    const first = oeNumbersPath(encodeProductCode(30, '0445110274'))
    const second = searchPath('0281006187')
    const { transport, calls } = transportFor({
      [first]: { status: 400 },
      [searchPath('0445110274')]: { status: 200, body: SEARCH_PAYLOAD },
      [oeNumbersPath('Ext-TA-MzA6MCA0NDUgMTEwIDI3NA')]: { status: 200, body: BOSCH_OES },
      [second]: { status: 200, body: { products: [] } },
      // Arama boş dönerse doğrudan kod yine denenir — o da tutmaz.
      [oeNumbersPath(encodeProductCode(30, '0281006187'))]: { status: 400 }
    })
    const source = createRepxpertSource({ transport, brandIds })

    await source.lookup('BOSCH', '0445110274')
    calls.length = 0
    await source.lookup('BOSCH', '0281006187')

    // Doğrudan kod bu markada çalışmıyor; ikinci üründe boşuna denenmemeli.
    expect(calls[0]).toBe(second)
  })
})
