import { describe, it, expect } from 'bun:test'
import {
  normalizeDinamikBarcode,
  scoreCandidate,
  type DinamikBarcodeField
} from './dinamik-parcatedarik-model-matcher'
import {
  classifyRefToken,
  type PartMatchType
} from './parcatedarik-to-parts-resolver'
import { normalizeModel, splitReferenceTokens } from './code-normalization'

describe('normalizeDinamikBarcode', () => {
  it('normalizes barcode values the same as normalizeModel', () => {
    expect(normalizeDinamikBarcode('yk4001311w')).toBe('YK4001311W')
  })

  it('handles null input', () => {
    expect(normalizeDinamikBarcode(null)).toBeNull()
  })

  it('handles undefined input', () => {
    expect(normalizeDinamikBarcode(undefined)).toBeNull()
  })

  it('handles empty string', () => {
    expect(normalizeDinamikBarcode('')).toBeNull()
  })

  it('handles whitespace-only input', () => {
    expect(normalizeDinamikBarcode('   ')).toBeNull()
  })

  it('removes hyphens, dots, spaces, slashes', () => {
    expect(normalizeDinamikBarcode('YK-400 1311/W')).toBe('YK4001311W')
  })

  it('preserves leading zeros', () => {
    expect(normalizeDinamikBarcode('0445110376')).toBe('0445110376')
  })
})

describe('scoreCandidate', () => {
  it('assigns 0.98 confidence for barcode_1 exact match', () => {
    const result = scoreCandidate({ barcodeField: 'barcode_1', brandMatch: false })
    expect(result.confidence).toBe(0.98)
    expect(result.matchReason).toBe('BARCODE_1_MODEL_EXACT')
  })

  it('assigns 0.96 confidence for barcode_2 exact match', () => {
    const result = scoreCandidate({ barcodeField: 'barcode_2', brandMatch: false })
    expect(result.confidence).toBe(0.96)
    expect(result.matchReason).toBe('BARCODE_2_MODEL_EXACT')
  })

  it('assigns 0.94 confidence for barcode_3 exact match', () => {
    const result = scoreCandidate({ barcodeField: 'barcode_3', brandMatch: false })
    expect(result.confidence).toBe(0.94)
    expect(result.matchReason).toBe('BARCODE_3_MODEL_EXACT')
  })

  it('applies +0.01 boost when brand matches', () => {
    const result = scoreCandidate({ barcodeField: 'barcode_1', brandMatch: true })
    expect(result.confidence).toBe(0.99)
  })

  it('brand match on barcode_2 yields 0.97', () => {
    const result = scoreCandidate({ barcodeField: 'barcode_2', brandMatch: true })
    expect(result.confidence).toBe(0.97)
  })

  it('brand match on barcode_3 yields 0.95', () => {
    const result = scoreCandidate({ barcodeField: 'barcode_3', brandMatch: true })
    expect(result.confidence).toBe(0.95)
  })

  it('respects maximum confidence cap at 0.99', () => {
    const result = scoreCandidate({ barcodeField: 'barcode_1', brandMatch: true })
    expect(result.confidence === 0.99).toBe(true)
  })
})

describe('classifyRefToken', () => {
  it('classifies 8+ digit numeric tokens as EAN_MATCH', () => {
    expect(classifyRefToken('8677309380')).toBe('EAN_MATCH')
  })

  it('classifies tokens starting with 2+ letters followed by 3+ digits as OEM_MATCH', () => {
    expect(classifyRefToken('VAG12345')).toBe('OEM_MATCH')
    expect(classifyRefToken('AB123')).toBe('OEM_MATCH')
  })

  it('classifies other tokens as CROSS_REFERENCE_MATCH', () => {
    expect(classifyRefToken('ABC')).toBe('CROSS_REFERENCE_MATCH')
    expect(classifyRefToken('123')).toBe('CROSS_REFERENCE_MATCH')
    // 1K0... starts with a digit, not 2+ letters
    expect(classifyRefToken('1K0919087A')).toBe('CROSS_REFERENCE_MATCH')
  })

  it('handles null-like values gracefully', () => {
    expect(classifyRefToken('---')).toBe('CROSS_REFERENCE_MATCH')
  })
})

describe('splitReferenceTokens', () => {
  it('splits comma-separated ref_no', () => {
    const tokens = splitReferenceTokens('1K0919087,VAG12345,ABC123')
    expect(tokens).toEqual(['1K0919087', 'VAG12345', 'ABC123'])
  })

  it('splits semicolon-separated ref_no', () => {
    const tokens = splitReferenceTokens('1K0919087;VAG12345')
    expect(tokens).toEqual(['1K0919087', 'VAG12345'])
  })

  it('splits pipe-separated ref_no', () => {
    const tokens = splitReferenceTokens('1K0919087|VAG12345')
    expect(tokens).toEqual(['1K0919087', 'VAG12345'])
  })

  it('splits slash-separated ref_no', () => {
    const tokens = splitReferenceTokens('1K0919087/VAG12345')
    expect(tokens).toEqual(['1K0919087', 'VAG12345'])
  })

  it('filters out tokens shorter than 2 characters', () => {
    const tokens = splitReferenceTokens('A,1K0919087,BB')
    expect(tokens).toEqual(['1K0919087', 'BB'])
  })

  it('returns empty array for null', () => {
    expect(splitReferenceTokens(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(splitReferenceTokens('')).toEqual([])
  })
})

describe('normalizeModel', () => {
  it('normalizes basic model codes', () => {
    // '1K0 919 087 A' → '1K0919087A' (spaces removed, uppercase, non-alnum removed)
    expect(normalizeModel('1K0 919 087 A')).toBe('1K0919087A')
  })

  it('handles hyphens and dots', () => {
    expect(normalizeModel('YK-400.1311/W')).toBe('YK4001311W')
  })

  it('returns null for null input', () => {
    expect(normalizeModel(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeModel('')).toBeNull()
  })

  it('returns null for whitespace-only', () => {
    expect(normalizeModel('   ')).toBeNull()
  })

  it('results in alphanumeric for mixed input', () => {
    expect(normalizeModel('(special)')).toBe('SPECIAL')
  })
})