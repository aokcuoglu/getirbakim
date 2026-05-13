import { describe, it, expect } from 'bun:test'
import { normalizeCode, compactCode, isExactCodeQuery } from './code-normalization'

describe('normalizeCode', () => {
  it('uppercases input', () => {
    expect(normalizeCode('abc123')).toBe('ABC123')
  })

  it('removes spaces', () => {
    expect(normalizeCode('ABC 123')).toBe('ABC123')
  })

  it('removes dashes', () => {
    expect(normalizeCode('ABC-123')).toBe('ABC123')
  })

  it('removes dots and slashes', () => {
    expect(normalizeCode('ABC.123/456')).toBe('ABC123456')
  })

  it('preserves leading zeros', () => {
    expect(normalizeCode('0445110376')).toBe('0445110376')
  })

  it('preserves leading zeros with separators', () => {
    expect(normalizeCode('0 445 110 376')).toBe('0445110376')
  })

  it('handles empty string', () => {
    expect(normalizeCode('')).toBe('')
  })

  it('handles null-like input', () => {
    expect(normalizeCode('   ')).toBe('')
  })

  it('handles Turkish OEM format', () => {
    expect(normalizeCode('Bosch 0 445 110 376')).toBe('BOSCH0445110376')
  })

  it('strips backslashes', () => {
    expect(normalizeCode('ABC\\123')).toBe('ABC123')
  })
})

describe('compactCode', () => {
  it('lowercases and removes non-alphanumeric', () => {
    expect(compactCode('ABC-123')).toBe('abc123')
  })

  it('preserves leading zero in compact form', () => {
    expect(compactCode('0445110376')).toBe('0445110376')
  })

  it('handles spaces and dashes', () => {
    expect(compactCode('0 445 110 376')).toBe('0445110376')
  })

  it('handles empty string', () => {
    expect(compactCode('')).toBe('')
  })
})

describe('isExactCodeQuery', () => {
  it('recognizes 0445110376 as exact code query', () => {
    expect(isExactCodeQuery('0445110376')).toBe(true)
  })

  it('recognizes short numeric codes with dashes as exact code', () => {
    expect(isExactCodeQuery('1K0-919-087')).toBe(true)
  })

  it('recognizes alphanumeric OEM codes', () => {
    expect(isExactCodeQuery('0 445 110 376')).toBe(true)
  })

  it('recognizes EAN codes', () => {
    expect(isExactCodeQuery('4250569403960')).toBe(true)
  })

  it('rejects natural language queries', () => {
    expect(isExactCodeQuery('yakit filtresi')).toBe(false)
  })

  it('rejects brand-only queries', () => {
    expect(isExactCodeQuery('Bosch')).toBe(false)
  })

  it('rejects short queries under 5 chars', () => {
    expect(isExactCodeQuery('ABC')).toBe(false)
  })

  it('recognizes mixed alphanumeric codes', () => {
    expect(isExactCodeQuery('B1455XS')).toBe(true)
  })

  it('rejects queries with too many separators', () => {
    expect(isExactCodeQuery('a b c d e f g')).toBe(false)
  })
})