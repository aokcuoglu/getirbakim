// The "Eşleşenler" tab's filter, sort and page over the cached groups (product-matching.ts). Pure, so the order can be
// tested against the SQL it replaces: ORDER BY <column> ASC|DESC NULLS LAST, then the largest saving
// (primary_price-selling_price DESC NULLS LAST), then primary_id in the database's order (`position`).

/** A grouped Başbuğ product without its offers; `codes` are the offers' codes as the search compares them. */
export type SameEntry = { primary_id: string; selling: string | null; selling_price: number | null; primary_price: number | null; codes: string; position: number };
export type SameScope = "all" | "dinamik" | "basbug" | "none" | "split";
export const sameSortColumns = { primary: "primary_price", selling: "selling_price" } as const;

/** `split` lists the manual decisions instead of groups; anything unknown is every group. */
export function sameScope(raw: string | undefined): SameScope {
  return raw === "split" || raw === "dinamik" || raw === "basbug" || raw === "none" ? raw : "all";
}

const nullsLast = (a: number | null, b: number | null, desc: boolean) =>
  a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : desc ? b - a : a - b;
const saving = (entry: SameEntry) => entry.primary_price === null || entry.selling_price === null ? null : entry.primary_price - entry.selling_price;

/** `q` is already compacted (A-Z0-9); a group matches when any offer code contains it. */
export function pickSameProducts(entries: SameEntry[], options: { scope: Exclude<SameScope, "split">; q: string; sort?: string; dir?: string; page: number; pageSize: number }) {
  const { scope, q, page, pageSize } = options;
  const filtered = entries.filter(entry => (scope === "all" || (scope === "none" ? entry.selling === null : entry.selling === scope))
    && (!q || entry.codes.includes(q)));
  const column = options.sort && Object.hasOwn(sameSortColumns, options.sort) ? sameSortColumns[options.sort as keyof typeof sameSortColumns] : null;
  const desc = options.dir === "desc";
  filtered.sort((a, b) => (column ? nullsLast(a[column], b[column], desc) : 0) || nullsLast(saving(a), saving(b), true) || a.position - b.position);
  return { total: filtered.length, listed: filtered.slice((page - 1) * pageSize, page * pageSize) };
}
