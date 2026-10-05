export type SearchParams = Record<string, string | string[] | undefined>;

// Match URLSearchParams.get: the first occurrence wins for repeated keys.
export function normalizeSearchParams(params: SearchParams): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [
    key, Array.isArray(value) ? value[0] : value,
  ]));
}
