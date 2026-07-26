import { describe, expect, it } from 'bun:test'
import { createOemSources, sourceForBrand, type RepxpertTransport } from './index'

const transport: RepxpertTransport = {
  async get() {
    throw new Error('bu testte istek atılmamalı')
  }
}

const REPXPERT_SITE = 'repxpert.com.tr'
const BILSTEIN_SITE = 'partsfinder.bilsteingroup.com'

describe('createOemSources', () => {
  it('REPXPERT kapalıyken kayıt değişmez', async () => {
    const sources = await createOemSources()
    expect(sources.map((s) => s.site)).toEqual([BILSTEIN_SITE, 'tecalliance-catalog'])
    // SWAG'i hâlâ resmi katalog karşılar.
    expect(sourceForBrand(sources, 'SWAG')?.site).toBe(BILSTEIN_SITE)
  })

  it('SWAG"i REPXPERT devralır, diğer bilstein markaları kalır', async () => {
    const sources = await createOemSources({
      repxpert: { transport, brandIds: { SWAG: 151, VALEO: 21 } }
    })
    expect(sourceForBrand(sources, 'SWAG')?.site).toBe(REPXPERT_SITE)
    expect(sourceForBrand(sources, 'swag')?.site).toBe(REPXPERT_SITE)
    expect(sourceForBrand(sources, 'FEBI')?.site).toBe(BILSTEIN_SITE)
    expect(sourceForBrand(sources, 'VALEO')?.site).toBe(REPXPERT_SITE)
  })

  it('devredilen marka bilstein"in --all listesinden düşer', async () => {
    const sources = await createOemSources({
      repxpert: { transport, brandIds: { SWAG: 151 } }
    })
    const bilstein = sources.find((s) => s.site === BILSTEIN_SITE)
    expect(bilstein?.brands().includes('SWAG')).toBe(false)
    expect(bilstein?.brands().includes('FEBI')).toBe(true)
  })

  it('REPXPERT o markayı kapsamıyorsa devir OLMAZ — marka kaynaksız kalmamalı', async () => {
    // Marka haritasında SWAG yok: bilstein'dan alınırsa hiçbir kaynağa düşmez.
    const sources = await createOemSources({
      repxpert: { transport, brandIds: { VALEO: 21 } }
    })
    expect(sourceForBrand(sources, 'SWAG')?.site).toBe(BILSTEIN_SITE)
  })
})
