import { describe, expect, it } from 'bun:test'
import {
  deriveDinamikStockContext,
  mergeDinamikItemsBySku,
  parseDinamikRegionalStock,
  type DinamikNormalizedStockItemBase
} from '@/lib/suppliers/dinamik-stock'

function buildItem(
  input: Partial<DinamikNormalizedStockItemBase>
): DinamikNormalizedStockItemBase {
  return {
    stokKodu: input.stokKodu || 'SKU-1',
    stokAdi: input.stokAdi ?? 'Test Product',
    marka: input.marka ?? 'TEST',
    fiyat: input.fiyat ?? null,
    campaignRate: input.campaignRate ?? 0,
    stokAdedi: input.stokAdedi ?? 0,
    barkod1: input.barkod1 ?? null,
    barkod2: input.barkod2 ?? null,
    barkod3: input.barkod3 ?? null,
    regionalStock: input.regionalStock ?? null,
    raw: input.raw ?? {}
  }
}

describe('deriveDinamikStockContext', () => {
  it('returns 5 stock when only varyok1 is VAR', () => {
    const result = deriveDinamikStockContext({ varyok1: 'VAR' }, [0])

    expect(result.stockQty).toBe(5)
    expect(result.regionalStock?.istanbul.hasStock).toBe(true)
    expect(result.regionalStock?.ankara.qty).toBe(0)
  })

  it('sums 5 per region when multiple regions are VAR', () => {
    const result = deriveDinamikStockContext(
      {
        varyok1: 'VAR',
        varyok2: 'VAR',
        varyok3: 'YOK',
        varyok4: 'YOK'
      },
      [0]
    )

    expect(result.stockQty).toBe(10)
    expect(result.regionalStock?.istanbul.qty).toBe(5)
    expect(result.regionalStock?.ankara.qty).toBe(5)
    expect(result.regionalStock?.kayseri.qty).toBe(0)
  })

  it('returns zero stock when all regional flags are YOK', () => {
    const result = deriveDinamikStockContext(
      {
        varyok1: 'YOK',
        varyok2: 'YOK',
        varyok3: 'YOK',
        varyok4: 'YOK'
      },
      [12]
    )

    expect(result.stockQty).toBe(0)
    expect(result.regionalStock?.kayseri.status).toBe('YOK')
  })

  it('falls back to legacy numeric stock fields when regional flags are absent', () => {
    const result = deriveDinamikStockContext({}, ['7 adet', 0])

    expect(result.stockQty).toBe(7)
    expect(result.regionalStock).toBeNull()
  })
})

describe('parseDinamikRegionalStock', () => {
  it('returns null when there are no recognized regional flags', () => {
    expect(parseDinamikRegionalStock({ foo: 'bar' })).toBeNull()
  })
})

describe('mergeDinamikItemsBySku', () => {
  it('preserves stock regional data when price rows are merged into stock rows', () => {
    const stockRegional = parseDinamikRegionalStock({
      varyok1: 'VAR',
      varyok2: 'YOK',
      varyok3: 'YOK',
      varyok4: 'YOK'
    })

    const merged = mergeDinamikItemsBySku(
      [
        buildItem({
          stokKodu: 'SKU-1',
          stokAdedi: 5,
          regionalStock: stockRegional,
          raw: { varyok1: 'VAR' }
        })
      ],
      [
        buildItem({
          stokKodu: 'SKU-1',
          fiyat: 125,
          raw: { fiyat: '125' }
        })
      ]
    )

    expect(merged.length).toBe(1)
    expect(merged[0]?.fiyat).toBe(125)
    expect(merged[0]?.stokAdedi).toBe(5)
    expect(JSON.stringify(merged[0]?.regionalStock)).toBe(
      JSON.stringify(stockRegional)
    )
  })
})
