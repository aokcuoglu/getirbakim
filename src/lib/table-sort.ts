// ?sort=<key>&dir=asc|desc from a server table header (TableHead `sortKey`) as an ORDER BY clause. Only keys listed in
// `columns` are accepted and their SQL is written by the caller, so nothing from the URL reaches the query text.
export function sortOrder(params: { sort?: string; dir?: string }, columns: Record<string, string>, fallback: string) {
  const column = params.sort && Object.hasOwn(columns, params.sort) ? columns[params.sort] : null;
  if (!column) return fallback;
  return `${column} ${params.dir === "desc" ? "DESC" : "ASC"} NULLS LAST, ${fallback}`;
}

// A filter/tab key from the URL, accepted only when it is an own key of `table` (never `constructor`, `__proto__`…).
export function pickKey<T extends object>(table: T, raw: string | undefined, fallback: keyof T & string): keyof T & string {
  return raw !== undefined && Object.hasOwn(table, raw) ? raw as keyof T & string : fallback;
}
