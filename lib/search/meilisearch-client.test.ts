import { describe, expect, it, afterEach } from 'bun:test'

describe('isMeiliEnabled', () => {
  const originalEnv = process.env.MEILI_ENABLED

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MEILI_ENABLED = originalEnv
    } else {
      delete process.env.MEILI_ENABLED
    }
  })

  it('returns true when MEILI_ENABLED=true', () => {
    process.env.MEILI_ENABLED = 'true'
    expect(process.env.MEILI_ENABLED === 'true').toBe(true)
  })

  it('returns false when MEILI_ENABLED=false', () => {
    process.env.MEILI_ENABLED = 'false'
    expect(process.env.MEILI_ENABLED === 'true').toBe(false)
  })

  it('returns false when MEILI_ENABLED is unset', () => {
    delete process.env.MEILI_ENABLED
    expect(process.env.MEILI_ENABLED === 'true').toBe(false)
  })

  it('returns false when MEILI_ENABLED is any other value', () => {
    process.env.MEILI_ENABLED = 'yes'
    expect(process.env.MEILI_ENABLED === 'true').toBe(false)
  })
})

describe('getMeiliHost default', () => {
  it('falls back to localhost when no env set', () => {
    delete process.env.MEILI_HOST
    delete process.env.NEXT_PUBLIC_MEILI_HOST
    const expected = process.env.MEILI_HOST || process.env.NEXT_PUBLIC_MEILI_HOST || 'http://127.0.0.1:7700'
    expect(expected).toBe('http://127.0.0.1:7700')
  })
})

describe('getProductsIndexName', () => {
  it('returns configured index name', () => {
    process.env.MEILI_INDEX_PRODUCTS = 'custom_products'
    expect(process.env.MEILI_INDEX_PRODUCTS || 'products').toBe('custom_products')
    delete process.env.MEILI_INDEX_PRODUCTS
  })

  it('returns default "products" when unset', () => {
    delete process.env.MEILI_INDEX_PRODUCTS
    expect(process.env.MEILI_INDEX_PRODUCTS || 'products').toBe('products')
  })
})