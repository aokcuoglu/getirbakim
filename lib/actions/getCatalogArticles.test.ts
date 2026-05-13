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