import { describe, expect, it } from 'bun:test'
import {
  buildHybridTokenBundles,
  foldTurkishForSearch,
  normalizeSearchInput,
  scoreHybridDocument
} from './hybrid-search'

describe('hybrid search tokenization', () => {
  it('tokenizes mixed vehicle + part queries', () => {
    const bundles = buildHybridTokenBundles('Seat Ibiza Hava Filtresi')
    expect(bundles.map((bundle) => bundle.token)).toEqual([
      'seat',
      'ibiza',
      'hava',
      'filtresi'
    ])
  })

  it('keeps Turkish-friendly folded alternatives', () => {
    const bundles = buildHybridTokenBundles('YAĞ FİLTRESİ')
    const yagBundle = bundles.find((bundle) => bundle.token === 'yag')

    expect(yagBundle?.alternatives.includes('yag')).toBe(true)
    expect(foldTurkishForSearch('ÇÖŞĞÜIİ')).toBe('cosguii')
  })

  it('generates compact alternatives for code-like tokens', () => {
    const bundles = buildHybridTokenBundles('03C-129-620')
    expect(bundles[0]?.alternatives.includes('03c-129-620')).toBe(true)
    expect(bundles[0]?.alternatives.includes('03c129620')).toBe(true)
  })

  it('normalizes whitespace safely', () => {
    expect(normalizeSearchInput('  Seat   Ibiza   ')).toBe('Seat Ibiza')
  })
})

describe('hybrid search scoring', () => {
  it('matches tokens across vehicle + part fields', () => {
    const score = scoreHybridDocument({
      query: 'Seat Ibiza Hava Filtresi',
      name: 'Hava Filtresi',
      vehicleTexts: ['Seat Ibiza 1.6 TDI']
    })

    expect(score.tokenMatches).toBe(4)
  })

  it('prioritizes exact code matches', () => {
    const score = scoreHybridDocument({
      query: '03C129620',
      oemCodes: ['03C129620']
    })

    expect(score.codeRank).toBe(2)
  })

  it('prioritizes code prefix matches after exact', () => {
    const score = scoreHybridDocument({
      query: '03C129',
      oemCodes: ['03C129620']
    })

    expect(score.codeRank).toBe(1)
  })
})
