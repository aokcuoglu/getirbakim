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

export function isExactCodeQuery(query: string): boolean {
  const trimmed = query.trim()
  if (trimmed.length < 5) return false

  const alnumCount = (trimmed.match(/[0-9a-zA-Z]/g) || []).length
  const sepCount = (trimmed.match(/[\s.\-\/\\]/g) || []).length
  const alnumRatio = alnumCount / trimmed.length

  if (alnumRatio < 0.6) return false
  if (sepCount > 3) return false

  const digits = (trimmed.match(/[0-9]/g) || []).length
  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length

  // Spare part codes must contain some digits to distinguish from brand names or natural language
  if (digits < 2) return false

  // Pure numeric or almost pure numeric codes (e.g. OEM or EAN)
  if (digits >= 4 && alnumRatio >= 0.6) return true

  // Alphanumeric codes (e.g., B1455XS, SKU-12345, 1K0-919-087)
  if (letters >= 2 && digits >= 2 && alnumRatio >= 0.6) return true

  return false
}