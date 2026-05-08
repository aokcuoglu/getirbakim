import { describe, expect, it } from 'bun:test'
import { buildCategoryUrl, buildCategoryPath } from '@/lib/catalog-url'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ıİ]/g, 'i')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function normalizeUrlKey(
  urlKey: string | null | undefined,
  name: string
): string {
  const candidate = (urlKey || '').trim().toLowerCase()
  if (!candidate) return generateSlug(name)
  return candidate.replace(/-\d{5,}$/, '')
}

describe('generateSlug', () => {
  it('generates slug from English category name', () => {
    expect(generateSlug('Fuel filter')).toBe('fuel-filter')
    expect(generateSlug('Oil filter')).toBe('oil-filter')
    expect(generateSlug('Air filter')).toBe('air-filter')
    expect(generateSlug('Cabin filter')).toBe('cabin-filter')
  })

  it('generates slug from Turkish category name', () => {
    expect(generateSlug('Yakıt filtresi')).toBe('yakit-filtresi')
    expect(generateSlug('Yağ filtresi')).toBe('yag-filtresi')
    expect(generateSlug('Hava filtresi')).toBe('hava-filtresi')
    expect(generateSlug('Polen filtresi')).toBe('polen-filtresi')
  })

  it('handles special Turkish characters', () => {
    expect(generateSlug('Şanzıman')).toBe('sanziman')
    expect(generateSlug('Ön cam')).toBe('on-cam')
    expect(generateSlug('Çıkış')).toBe('cikis')
    expect(generateSlug('Ürün')).toBe('urun')
  })

  it('handles multi-word names', () => {
    expect(generateSlug('Brake pad wear indicators')).toBe('brake-pad-wear-indicators')
    expect(generateSlug('Handbrake parts')).toBe('handbrake-parts')
  })
})

describe('normalizeUrlKey', () => {
  it('returns url_key when present', () => {
    expect(normalizeUrlKey('fuel-filters', 'Fuel filter')).toBe('fuel-filters')
    expect(normalizeUrlKey('air-filters', 'Air filter')).toBe('air-filters')
  })

  it('returns name-derived slug when url_key is null', () => {
    expect(normalizeUrlKey(null, 'Fuel filter')).toBe('fuel-filter')
    expect(normalizeUrlKey(null, 'Oil filter')).toBe('oil-filter')
    expect(normalizeUrlKey(null, 'Air filter')).toBe('air-filter')
  })

  it('returns name-derived slug when url_key is empty string', () => {
    expect(normalizeUrlKey('', 'Fuel filter')).toBe('fuel-filter')
    expect(normalizeUrlKey('  ', 'Oil filter')).toBe('oil-filter')
  })

  it('returns name-derived slug when url_key is undefined', () => {
    expect(normalizeUrlKey(undefined, 'Cabin filter')).toBe('cabin-filter')
  })

  it('strips legacy ID suffixes from url_key', () => {
    expect(normalizeUrlKey('fuel-filter-100384', 'Fuel filter')).toBe('fuel-filter')
    expect(normalizeUrlKey('air-filter-100241', 'Air filter')).toBe('air-filter')
  })

  it('preserves short numeric suffixes (less than 5 digits)', () => {
    expect(normalizeUrlKey('filter-1234', 'Filter')).toBe('filter-1234')
  })

  it('lowercases url_key', () => {
    expect(normalizeUrlKey('Fuel-Filter', 'Fuel filter')).toBe('fuel-filter')
  })
})

describe('category URL generation', () => {
  it('builds canonical category URLs with locale prefix', () => {
    expect(
      buildCategoryUrl('en', { categoryUrlKey: 'fuel-filter' })
    ).toBe('/en/fuel-filter')
    expect(
      buildCategoryUrl('tr', { categoryUrlKey: 'yakit-filtresi' })
    ).toBe('/tr/yakit-filtresi')
  })

  it('defaults to car-parts when category is missing', () => {
    expect(buildCategoryUrl('en', {})).toBe('/en/car-parts')
    expect(buildCategoryUrl('tr', { categoryUrlKey: null })).toBe('/tr/car-parts')
  })

  it('builds relative category paths without locale', () => {
    expect(buildCategoryPath({ categoryUrlKey: 'fuel-filter' })).toBe('/fuel-filter')
    expect(buildCategoryPath({ categoryUrlKey: 'brake-system' })).toBe('/brake-system')
  })
})

describe('category slug resolution consistency', () => {
  it('link generation and lookup slug match for categories without url_key', () => {
    const dbUrlKey = null
    const dbName = 'Fuel filter'
    const linkSlug = normalizeUrlKey(dbUrlKey, dbName)
    const lookupSlug = generateSlug(dbName)
    expect(linkSlug).toBe(lookupSlug)
    expect(linkSlug).toBe('fuel-filter')
  })

  it('link generation and lookup slug match for categories with url_key', () => {
    const dbUrlKey = 'fuel-filters'
    const dbName = 'Fuel filter'
    const linkSlug = normalizeUrlKey(dbUrlKey, dbName)
    expect(linkSlug).toBe('fuel-filters')
  })

  it('normalizeUrlKey produces consistent slugs for Turkish names', () => {
    expect(normalizeUrlKey(null, 'Yakıt filtresi')).toBe('yakit-filtresi')
    expect(generateSlug('Yakıt filtresi')).toBe('yakit-filtresi')
  })

  it('plural url_key does not match singular name slug', () => {
    const pluralUrlKey = normalizeUrlKey('fuel-filters', 'Fuel filter')
    const singularNameSlug = normalizeUrlKey(null, 'Fuel filter')
    expect(pluralUrlKey).toBe('fuel-filters')
    expect(singularNameSlug).toBe('fuel-filter')
    expect(pluralUrlKey).not.toBe(singularNameSlug)
  })
})