/**
 * Code Normalization Utilities
 *
 * Centralized functions for normalizing OEM codes, SKUs, brand names,
 * and splitting supplier reference tokens.
 *
 * Used by:
 * - lib/search/code-normalization.ts (original, re-exports from here)
 * - scripts/map-dinamik-products-to-parts.ts
 */

export function normalizeCode(value: string): string {
  if (!value) return ''
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-./\\]+/g, '')
}

export function compactCode(value: string): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, '')
}

export function normalizeModel(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  const result = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return result.length > 0 ? result : null
}

export function normalizeOem(input: string | null | undefined): string | null {
  if (!input) return null
  const result = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return result.length > 0 ? result : null
}

export function normalizeSku(input: string | null | undefined): string | null {
  if (!input) return null
  const result = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return result.length > 0 ? result : null
}

export function normalizeBrandName(input: string | null | undefined): string | null {
  if (!input) return null
  const result = input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
  return result.length > 0 ? result : null
}

export interface ParsedOem {
  /** Vehicle-maker brand (leading alphabetic tokens), uppercased; null if absent. */
  brand: string | null
  /** OEM code preserving internal spacing/dashes, like public.part_oens.code. */
  code: string
  /** normalizeOem(code) — the matching key (product_oems.code_norm). */
  codeNorm: string
}

/**
 * Parse a free-text OEM entry list into {brand, code, codeNorm} rows shaped like
 * public.part_oens (separate brand column + formatted code). Entries are split
 * on comma / newline / semicolon. Within an entry, leading purely-alphabetic
 * tokens are the vehicle-maker brand and the first token containing a digit
 * starts the code (which keeps its spacing/dashes, e.g. "1J0 407 365 C").
 * Handles multi-word brands ("ALFA ROMEO 60816448") and spaced codes.
 * Entries whose code normalizes to < 3 chars are dropped; deduped by codeNorm.
 *
 *   "DAF 1812163, MERCEDES-BENZ 0019934196"
 *     → [{ brand:'DAF', code:'1812163', codeNorm:'1812163' },
 *        { brand:'MERCEDES-BENZ', code:'0019934196', codeNorm:'0019934196' }]
 */
export function parseOemEntries(input: string | null | undefined): ParsedOem[] {
  if (!input) return []
  const out: ParsedOem[] = []
  const seen = new Set<string>()
  for (const rawEntry of input.split(/[,\n;]+/)) {
    const entry = rawEntry.trim().replace(/\s+/g, ' ')
    if (!entry) continue
    const tokens = entry.split(' ')
    // İlk rakam içeren token kodu başlatır; öncesindeki kelimeler markadır.
    const codeStart = tokens.findIndex((t) => /\d/.test(t))
    let brand: string | null
    let code: string
    if (codeStart > 0) {
      brand = tokens.slice(0, codeStart).join(' ').toUpperCase()
      code = tokens.slice(codeStart).join(' ')
    } else {
      // Rakam yok ya da ilk token zaten kod → marka yok.
      brand = null
      code = entry
    }
    const codeNorm = normalizeOem(code)
    if (!codeNorm || codeNorm.length < 3) continue
    if (seen.has(codeNorm)) continue
    seen.add(codeNorm)
    out.push({ brand, code, codeNorm })
  }
  return out
}

const REF_NO_SEPARATORS = /[,;|/]/

export function splitReferenceTokens(refNo: string | null | undefined): string[] {
  if (!refNo) return []
  return refNo
    .split(REF_NO_SEPARATORS)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
}

export function isExactCodeQuery(query: string): boolean {
  const trimmed = query.trim()
  if (trimmed.length < 5) return false

  const alnumCount = (trimmed.match(/[0-9a-zA-Z]/g) || []).length
  const sepCount = (trimmed.match(/[\s.\-\/\\]/g) || []).length
  const alnumRatio = alnumCount / trimmed.length

  if (alnumRatio < 0.7) return false
  if (sepCount > 3) return false

  const digits = (trimmed.match(/[0-9]/g) || []).length
  if (digits >= 4 && alnumRatio >= 0.75) return true

  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length
  if (letters >= 3 && digits >= 2 && alnumRatio >= 0.75) return true

  return false
}

export type RefTokenClassification =
  | 'OEM_MATCH'
  | 'EAN_MATCH'
  | 'CROSS_REFERENCE_MATCH'
  | 'PART_NO_MATCH'
  | 'UNKNOWN_REFERENCE'

export interface ClassifiedRefToken {
  rawRef: string
  normalizedRef: string
  matchTypes: RefTokenClassification[]
  matchedPartIds: bigint[]
  matchedBrands: string[]
  confidenceBase: number
  isOemConfirmed: boolean
}