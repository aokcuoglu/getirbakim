/**
 * Code Normalization Utilities
 *
 * Centralized functions for normalizing OEM codes, SKUs, brand names,
 * and splitting ParcaTedarik ref_no tokens.
 *
 * Used by:
 * - lib/search/code-normalization.ts (original, re-exports from here)
 * - lib/matching/parcatedarik-reference-classifier.ts
 * - lib/matching/dinamik-parcatedarik-matcher.ts
 * - scripts/dinamik-parcatedarik-oem-bridge.ts
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