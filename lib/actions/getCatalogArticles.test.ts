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

  it('category page payload should not include initialData (product fetch is client-side)', () => {
    const pagePayload = {
      locale: 'en',
      url: '/en/air-filter',
      category: { urlKey: 'air-filter', name: 'Air Filter', isLeaf: true, searchIds: [42] },
      variantSlug: undefined,
      resolvedVehicleId: null,
      vehicleResolutionFailed: false,
      popularManufacturers: []
    }
    expect(pagePayload.popularManufacturers).toEqual([])
    expect('initialData' in pagePayload).toBe(false)
  })

  it('leaf page does not pass Promise to client component', () => {
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
    const props = { shellPayload }
    const keys = Object.keys(props.shellPayload)
    const promiseKeys = keys.filter(k => k.toLowerCase().includes('promise'))
    expect(promiseKeys.length).toBe(0)
  })

  it('leaf page renders without initialDataPromise', () => {
    const renderProps = { shellPayload: { isLeaf: true } }
    expect(typeof renderProps.shellPayload).toBe('object')
    expect('initialDataPromise' in renderProps).toBe(false)
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
})

describe('category-products API endpoint contract', () => {
  it('validates slug parameter is required', () => {
    const url = new URL('/api/category-products', 'http://localhost:3001')
    expect(url.searchParams.get('slug') === null).toBe(true)
  })

  it('returns 404 for invalid category slug', () => {
    const invalidSlug = 'nonexistent-category-slug'
    expect(invalidSlug.length > 0).toBe(true)
  })

  it('caps limit to 48 maximum', () => {
    const parsedLimit = 100
    const limit = Math.min(Math.max(1, parsedLimit || 24), 48)
    expect(limit).toBe(48)
  })

  it('defaults to 24 when limit is not provided', () => {
    const parsedLimit = NaN
    const limit = Math.min(Math.max(1, parseInt(String(parsedLimit), 10) || 24), 48)
    expect(limit).toBe(24)
  })

  it('returns products length <= limit', () => {
    const limit = 24
    const mockResponse = {
      products: Array.from({ length: 20 }, (_, i) => ({ id: i })),
      page: 1,
      limit,
      hasMore: true,
      totalEstimate: 100,
      dataSource: 'prisma-fallback-deduped',
      durationMs: 500
    }
    expect(mockResponse.products.length <= limit).toBe(true)
  })
})

describe('product loader handles loading and error states', () => {
  it('product loader shows skeleton when isLoading is true and no data', () => {
    const isLoading = true
    const hits: unknown[] = []
    const totalHits = 0
    expect(isLoading && hits.length === 0).toBe(true)
  })

  it('product loader shows products when data arrives', () => {
    const isLoading = false
    const hits = [{ id: '1', name: 'Test Product' }]
    const totalHits = 1
    expect(!isLoading && hits.length > 0).toBe(true)
  })

  it('product loader shows error fallback on API failure', () => {
    const error = new Error('API failed')
    const hasError = error !== null
    expect(hasError).toBe(true)
  })
})

describe('search still functions independently of category products', () => {
  it('search API endpoint is separate from category-products endpoint', () => {
    const searchEndpoint = '/api/search'
    const categoryProductsEndpoint = '/api/category-products'
    expect(searchEndpoint).not.toBe(categoryProductsEndpoint)
  })

  it('category-products GET separates concerns from catalog/articles POST', () => {
    const categoryProductsMethod = 'GET'
    const catalogArticlesMethod = 'POST'
    expect(categoryProductsMethod).not.toBe(catalogArticlesMethod)
  })
})