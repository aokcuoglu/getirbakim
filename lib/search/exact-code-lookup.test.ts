import { describe, it, expect } from 'bun:test'
import { isExactCodeQuery } from './exact-code-lookup'

describe('isExactCodeQuery (from exact-code-lookup)', () => {
  it('delegates to code-normalization isExactCodeQuery', () => {
    expect(isExactCodeQuery('0445110376')).toBe(true)
    expect(isExactCodeQuery('Bosch')).toBe(false)
    expect(isExactCodeQuery('short')).toBe(false)
  })

  it('recognizes OEM codes with spaces and dashes', () => {
    expect(isExactCodeQuery('0 445 110 376')).toBe(true)
  })

  it('recognizes short codes that have enough digits', () => {
    expect(isExactCodeQuery('B1234')).toBe(true)
  })
})