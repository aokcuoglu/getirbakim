// The "Eşleşenler" tab's filter, sort and page over the cached groups (product-matching.ts). Pure, so the order can be
// tested against the SQL it replaces: ORDER BY <column> ASC|DESC NULLS LAST, then the largest saving
// (primary_price-selling_price DESC NULLS LAST), then primary_id in the database's order (`position`).
import { normalizeSearchText } from "@/modules/search/query";

/** A grouped Başbuğ product without its offers; `codes` are the offers' codes as the search compares them. */
export type SameEntry = { primary_id: string; selling: string | null; selling_price: number | null; primary_price: number | null; codes: string; position: number };
type SameScope = "all" | "dinamik" | "basbug" | "none" | "manual";
const sameSortColumns = { primary: "primary_price", selling: "selling_price" } as const;

/** `manual` lists the manual decisions instead of groups (`split` is its old name); anything unknown is every group. */
export function sameScope(raw: string | undefined): SameScope {
  if (raw === "manual" || raw === "split") return "manual";
  return raw === "dinamik" || raw === "basbug" || raw === "none" ? raw : "all";
}

/** A code as the matching page compares codes and part numbers: A-Z0-9 only, at most 80 characters. */
export const compactCode = (value: string | undefined) => value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 80) ?? "";

/**
 * The "Elle kararlar" search: `code` for supplier codes and part numbers, `text` for names as db search_normalize
 * writes them ("Yağ Filtresi" → "yag filtresi").
 */
export function manualSearchTerms(raw: string | undefined) {
  return { code: compactCode(raw), text: normalizeSearchText((raw ?? "").slice(0, 80)) };
}

const nullsLast = (a: number | null, b: number | null, desc: boolean) =>
  a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : desc ? b - a : a - b;
const saving = (entry: SameEntry) => entry.primary_price === null || entry.selling_price === null ? null : entry.primary_price - entry.selling_price;

/** `q` is already compacted (A-Z0-9); a group matches when any offer code contains it. */
export function pickSameProducts(entries: SameEntry[], options: { scope: Exclude<SameScope, "manual">; q: string; sort?: string; dir?: string; page: number; pageSize: number }) {
  const { scope, q, page, pageSize } = options;
  const filtered = entries.filter(entry => (scope === "all" || (scope === "none" ? entry.selling === null : entry.selling === scope))
    && (!q || entry.codes.includes(q)));
  const column = options.sort && Object.hasOwn(sameSortColumns, options.sort) ? sameSortColumns[options.sort as keyof typeof sameSortColumns] : null;
  const desc = options.dir === "desc";
  filtered.sort((a, b) => (column ? nullsLast(a[column], b[column], desc) : 0) || nullsLast(saving(a), saving(b), true) || a.position - b.position);
  return { total: filtered.length, listed: filtered.slice((page - 1) * pageSize, page * pageSize) };
}
