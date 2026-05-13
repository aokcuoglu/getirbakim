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

  if (alnumRatio < 0.7) return false
  if (sepCount > 3) return false

  const digits = (trimmed.match(/[0-9]/g) || []).length
  if (digits >= 4 && alnumRatio >= 0.75) return true

  const letters = (trimmed.match(/[a-zA-Z]/g) || []).length
  if (letters >= 3 && digits >= 2 && alnumRatio >= 0.75) return true

  return false
}