import { describe, it, expect } from 'bun:test'
import { normalizeModel } from './code-normalization'

describe('normalizeModel', () => {
  it('trims and uppercases input', () => {
    expect(normalizeModel('yk4001311w')).toBe('YK4001311W')
  })

  it('removes hyphens', () => {
    expect(normalizeModel('YK-400-1311W')).toBe('YK4001311W')
  })

  it('removes spaces', () => {
    expect(normalizeModel('YK 400 1311 W')).toBe('YK4001311W')
  })

  it('removes dots', () => {
    expect(normalizeModel('YK.400.1311W')).toBe('YK4001311W')
  })

  it('removes slashes', () => {
    expect(normalizeModel('YK/400/1311W')).toBe('YK4001311W')
  })

  it('removes all non-alphanumeric characters', () => {
    expect(normalizeModel('YK-400.1311/W (special)')).toBe('YK4001311WSPECIAL')
  })

  it('preserves leading zeros', () => {
    expect(normalizeModel('25106304x10')).toBe('25106304X10')
  })

  it('preserves leading zeros with hyphens', () => {
    expect(normalizeModel('0-445-110-376')).toBe('0445110376')
  })

  it('returns null for empty string', () => {
    expect(normalizeModel('')).toBeNull()
  })

  it('returns null for null', () => {
    expect(normalizeModel(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(normalizeModel(undefined)).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(normalizeModel('   ')).toBeNull()
  })

  it('returns null when only non-alphanumeric chars remain after strip', () => {
    expect(normalizeModel('---...///')).toBeNull()
  })

  it('handles mixed separators and special chars', () => {
    expect(normalizeModel('1K0-919.087/A')).toBe('1K0919087A')
  })

  it('handles Turkish characters as non-alphanumeric', () => {
    expect(normalizeModel('şğçöü')).toBeNull()
  })

  it('handles numeric-only model codes', () => {
    expect(normalizeModel('1234567890')).toBe('1234567890')
  })
})