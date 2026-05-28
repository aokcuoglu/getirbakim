const SPECIAL_CHARS = /[^a-zA-Z0-9_\-. ]/g
const MULTI_SPACE = /\s{2,}/g

export function normalizeCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(SPECIAL_CHARS, '')
    .replace(MULTI_SPACE, ' ')
    .trim()
}

export function compactCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]/g, '')
}
