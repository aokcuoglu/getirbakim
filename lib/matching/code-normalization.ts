const BRAND_SUFFIXES = /\s+(oto (yedek|parça)|yedek parça|oto parça|automotive|spare parts|parts|otomotiv|sanayi|ticaret|limited|şirketi|ltd\.?|ltd şti|tic$)/gi
const NON_ALPHA = /[^a-z0-9çğıöşü]/g

export function normalizeModel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(NON_ALPHA, '')
    .replace(/\s+/g, '')
}

export function normalizeBrandName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(BRAND_SUFFIXES, '')
    .replace(NON_ALPHA, '')
    .replace(/\s+/g, '')
    .trim()
}
