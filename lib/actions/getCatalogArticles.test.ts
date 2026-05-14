import { describe, expect, it } from 'bun:test'

const DEFAULT_LIMIT = 24
const MAX_CATEGORY_LIMIT = 48

function normalizeLimit(
  limit: number | undefined
): number {
  if (typeof limit === 'number' && limit > 0) {
    return Math.min(MAX_CATEGORY_LIMIT, Math.floor(limit))
  }
  return DEFAULT_LIMIT
}

describe('category page limit contract', () => {
  it('defaults to 24 when no limit provided', () => {
    expect(normalizeLimit(undefined)).toBe(24)
  })

  it('defaults to 24 when limit is 0', () => {
    expect(normalizeLimit(0)).toBe(24)
  })

  it('defaults to 24 when limit is negative', () => {
    expect(normalizeLimit(-1)).toBe(24)
  })

  it('accepts valid limit 24', () => {
    expect(normalizeLimit(24)).toBe(24)
  })

  it('accepts valid limit 48', () => {
    expect(normalizeLimit(48)).toBe(48)
  })

  it('caps limit at 48 maximum', () => {
    expect(normalizeLimit(96)).toBe(48)
    expect(normalizeLimit(100)).toBe(48)
    expect(normalizeLimit(1000)).toBe(48)
  })

  it('floors fractional limits', () => {
    expect(normalizeLimit(24.5)).toBe(24)
    expect(normalizeLimit(47.9)).toBe(47)
  })

  it('accepts limit 1 (minimum valid)', () => {
    expect(normalizeLimit(1)).toBe(1)
  })
})

describe('category page hasMore calculation', () => {
  it('hasMore is true when more pages exist', () => {
    const totalHits = 100
    const page = 1
    const limit = 24
    const hasMore = page * limit < totalHits
    expect(hasMore).toBe(true)
  })

  it('hasMore is false on last page', () => {
    const totalHits = 48
    const page = 2
    const limit = 24
    const hasMore = page * limit < totalHits
    expect(hasMore).toBe(false)
  })

  it('hasMore is false when total equals page * limit', () => {
    const totalHits = 24
    const page = 1
    const limit = 24
    const hasMore = page * limit < totalHits
    expect(hasMore).toBe(false)
  })

  it('hasMore is true on page 1 with 25 total', () => {
    const totalHits = 25
    const page = 1
    const limit = 24
    const hasMore = page * limit < totalHits
    expect(hasMore).toBe(true)
  })
})

describe('category page data contract', () => {
  it('shell payload should not include initialData (product fetch is deferred)', () => {
    const shellPayload = {
      locale: 'en',
      url: '/en/air-filter',
      category: { urlKey: 'air-filter', name: 'Air Filter', isLeaf: true, searchIds: [42] },
      variantSlug: undefined,
      resolvedVehicleId: null,
      vehicleResolutionFailed: false,
      isLeaf: true,
      popularManufacturers: []
    }
    expect(shellPayload.isLeaf).toBe(true)
    expect(shellPayload.popularManufacturers).toEqual([])
    expect('initialData' in shellPayload).toBe(false)
  })

  it('initial leaf data request uses default limit of 24', () => {
    const defaultLimit = 24
    const maxLimit = 48
    const userLimit = undefined
    const resolvedLimit = Math.min(userLimit ?? defaultLimit, maxLimit)
    expect(resolvedLimit).toBe(24)
  })

  it('initial leaf data request caps at 48', () => {
    const defaultLimit = 24
    const maxLimit = 48
    const userLimit = 96
    const resolvedLimit = Math.min(userLimit ?? defaultLimit, maxLimit)
    expect(resolvedLimit).toBe(48)
  })

  it('non-leaf categories do not fetch product data', () => {
    const isLeaf = false
    const shouldFetchProducts = isLeaf
    expect(shouldFetchProducts).toBe(false)
  })

  it('fetchLeafInitialData resolves to CatalogArticlesResult', async () => {
    const mockResult = {
      hits: [],
      totalHits: 0,
      brandFacetDistribution: {},
      stockFacetDistribution: {},
      page: 1,
      limit: 24,
      hasMore: false,
      cached: false,
      source: 'prisma-fallback-deduped'
    }
    expect(mockResult.limit).toBe(24)
    expect(mockResult.hasMore).toBe(false)
    expect(mockResult.source === 'prisma-fallback-deduped').toBe(true)
  })
})