// The "Eşleşenler" tab's filter, sort and page over the cached groups (product-matching.ts). Pure, so the order can be
// tested against the SQL it replaces: ORDER BY <column> ASC|DESC NULLS LAST, then the largest saving
// (primary_price-selling_price DESC NULLS LAST), then primary_id in the database's order (`position`).
import { normalizeSearchText } from "@/modules/search/query";

/** A grouped Başbuğ product without its offers; `codes` are the offers' codes as the search compares them. */
export type SameEntry = { primary_id: string; selling: string | null; selling_price: number | null; primary_price: number | null; codes: string; position: number; manual: boolean };
type SameScope = "all" | "dinamik" | "basbug" | "none" | "manual";
const sameSortColumns = { primary: "primary_price", selling: "selling_price" } as const;

/** `manual` lists the manual decisions instead of groups (`split` is its old name); anything unknown is every group. */
export function sameScope(raw: string | undefined): SameScope {
  if (raw === "manual" || raw === "split") return "manual";
  return raw === "dinamik" || raw === "basbug" || raw === "none" ? raw : "all";
}

/** "Elle kararlar" kind filter from `?kind=`: only `merge` (Birleştirme) or `split` (Ayırma); anything else is no filter. */
export type ManualKind = "merge" | "split";
export const manualKind = (raw: string | undefined): ManualKind | null => raw === "merge" || raw === "split" ? raw : null;

/** `?linked=manual` narrows the matched groups to those with an offer linked by hand; anything else is no filter. */
export const sameLinked = (raw: string | undefined) => raw === "manual";

/** A code as the matching page compares codes and part numbers: A-Z0-9 only, at most 80 characters. */
export const compactCode = (value: string | undefined) => value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 80) ?? "";

/**
 * The "Elle kararlar" search: whitespace-separated words, each required ("FEBI 100261" = brand and number). A word
 * matches as `code` (supplier code or part number, compacted after Turkish letters are folded) or as `text` (names and
 * the brand as db search_normalize writes them: "Yağ" → "yag"). At most 6 distinct words of the first 80 characters.
 */
export function manualSearchTerms(raw: string | undefined) {
  const terms: { code: string; text: string }[] = [];
  for (const word of (raw ?? "").slice(0, 80).split(/\s+/)) {
    const text = normalizeSearchText(word), code = compactCode(text);
    if ((code || text) && !terms.some(term => term.code === code && term.text === text)) terms.push({ code, text });
  }
  return terms.slice(0, 6);
}

const nullsLast = (a: number | null, b: number | null, desc: boolean) =>
  a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : desc ? b - a : a - b;
const saving = (entry: SameEntry) => entry.primary_price === null || entry.selling_price === null ? null : entry.primary_price - entry.selling_price;

/** `q` is already compacted (A-Z0-9); a group matches when any offer code contains it. */
export function pickSameProducts(entries: SameEntry[], options: { scope: Exclude<SameScope, "manual">; q: string; linked?: boolean; sort?: string; dir?: string; page: number; pageSize: number }) {
  const { scope, q, page, pageSize } = options;
  const filtered = entries.filter(entry => (scope === "all" || (scope === "none" ? entry.selling === null : entry.selling === scope))
    && (!q || entry.codes.includes(q)) && (!options.linked || entry.manual));
  const column = options.sort && Object.hasOwn(sameSortColumns, options.sort) ? sameSortColumns[options.sort as keyof typeof sameSortColumns] : null;
  const desc = options.dir === "desc";
  filtered.sort((a, b) => (column ? nullsLast(a[column], b[column], desc) : 0) || nullsLast(saving(a), saving(b), true) || a.position - b.position);
  return { total: filtered.length, listed: filtered.slice((page - 1) * pageSize, page * pageSize) };
}
