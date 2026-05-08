import { describe, expect, it } from 'bun:test'
import {
  buildCategoryPath,
  buildCategoryUrl,
  buildCatalogAliasPath,
  buildCatalogAliasUrl,
  buildCatalogPath,
  buildCatalogUrl
} from '@/lib/catalog-url'

describe('catalog url helpers', () => {
  it('builds canonical category paths with variant and filters', () => {
    expect(
      buildCategoryPath({
        categoryUrlKey: 'brake-system',
        variantSlug: 'vw-golf-123-vtid',
        searchParams: {
          brands: 'bosch|ate',
          page: 2
        }
      })
    ).toBe('/brake-system?variant=vw-golf-123-vtid&brands=bosch%7Cate&page=2')
  })

  it('defaults to car-parts when category is missing', () => {
    expect(buildCategoryPath()).toBe('/car-parts')
    expect(buildCategoryUrl('tr', {})).toBe('/tr/car-parts')
  })

  it('keeps backward-compatible catalog alias builders available', () => {
    expect(
      buildCatalogAliasPath({
        categoryUrlKey: 'brake-system',
        variantSlug: 'vw-golf-123-vtid'
      })
    ).toBe('/catalog?cat=brake-system&variant=vw-golf-123-vtid')

    expect(
      buildCatalogAliasUrl('en', {
        categoryUrlKey: 'brake-system',
        searchParams: { page: 3 }
      })
    ).toBe('/en/catalog?cat=brake-system&page=3')
  })

  it('maps legacy buildCatalog helpers to canonical category URLs', () => {
    expect(
      buildCatalogPath({
        categoryUrlKey: 'oils-and-fluids'
      })
    ).toBe('/oils-and-fluids')

    expect(
      buildCatalogUrl('tr', {
        categoryUrlKey: 'oils-and-fluids',
        searchParams: { sort: 'price-asc' }
      })
    ).toBe('/tr/oils-and-fluids?sort=price-asc')
  })

  it('produces canonical category URLs for suffixed url_keys after normalization', () => {
    expect(
      buildCategoryUrl('en', { categoryUrlKey: 'fuel-filter' })
    ).toBe('/en/fuel-filter')

    expect(
      buildCategoryPath({ categoryUrlKey: 'fuel-filter' })
    ).toBe('/fuel-filter')
  })

  it('handles category URLs with variant slugs', () => {
    expect(
      buildCategoryUrl('en', {
        categoryUrlKey: 'fuel-filter',
        variantSlug: 'vw-golf-123-vtid'
      })
    ).toBe('/en/fuel-filter?variant=vw-golf-123-vtid')
  })
})
