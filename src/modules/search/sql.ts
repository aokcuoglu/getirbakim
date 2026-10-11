import "server-only";
import { db } from "@/lib/db";
import { compactSearchCode, exactTsQuery, normalizeSearchText, parseSearchQuery, prefixTsQuery, type ParsedSearch, type ParseOptions } from "./query";

/** Appends a value to the statement's parameters and returns its placeholder ("$3"). */
export type Bind = (value: unknown) => string;
export type SearchMode = "all" | "code";
export type SearchScope = "vehicle" | "product";

export function binder(values: unknown[]): Bind {
  return value => { values.push(value); return `$${values.length}`; };
}

/**
 * Condition over a supplier_items row that uses the indexes in db/search.sql: every required word
 * as a word prefix (not a substring: "y" must not match "5YJS"), or the part/OEM number with any spacing.
 */
export function supplierItemMatch(alias: string, parsed: ParsedSearch, bind: Bind, mode: SearchMode = "all") {
  const clauses: string[] = [];
  // compact is [a-z0-9] only, so it needs no LIKE escaping.
  if (parsed.compact.length >= 3) clauses.push(`supplier_item_search_codes(${alias}.code, ${alias}.product_data) LIKE ${bind(`%${parsed.compact}%`)}`);
  const query = prefixTsQuery(parsed);
  if (mode === "all" && query) clauses.push(`to_tsvector('simple', supplier_item_search_text(${alias}.code, ${alias}.product_data)) @@ to_tsquery('simple', ${bind(query)})`);
  return clauses.length ? `(${clauses.join(" OR ")})` : "false";
}

// Turkish letters a normalized (ASCII) query letter stands for; ~* covers the ASCII case pair.
const turkishVariants: Record<string, string> = { c: "cçÇ", g: "gğĞ", i: "iıİ", o: "oöÖ", s: "sşŞ", u: "uüÜ" };

/**
 * Dinamik rows keep their own field names (stokAdi, oemListe…), which the indexed supplier text above does not read.
 * Every word must start a word in name, code, OEM/equivalent lists or part type ("on" finds "ON FREN", not
 * "FRONTERA"); the part-number branch uses the shared trigram index. Folding sits in the pattern, so the row text
 * is read as is: one regex per row stays ~0.3 s over ~1M rows (per-row search_normalize took ~6 s).
 */
export function dinamikItemMatch(alias: string, raw: string, bind: Bind) {
  const words = normalizeSearchText(raw).split(" ").filter(Boolean).slice(0, 8);
  const text = `concat_ws(' ',${alias}.product_data->>'stokAdi',${alias}.code,${alias}.product_data->>'oemListe',${alias}.product_data->>'esdegerListe',${alias}.product_data->>'kull8s')`;
  // Normalized words are [a-z0-9.] only: "." is the one regex metacharacter to escape.
  const pattern = words.map(word => `(?=.*\\m${[...word].map(char => char === "." ? "\\." : turkishVariants[char] ? `[${turkishVariants[char]}]` : char).join("")})`).join("");
  const clauses = words.length ? [`${text} ~* ${bind(`^${pattern}`)}`] : [];
  const compact = compactSearchCode(raw);
  if (compact.length >= 3) clauses.push(`supplier_item_search_codes(${alias}.code, ${alias}.product_data) LIKE ${bind(`%${compact}%`)}`);
  return clauses.length ? `(${clauses.join(" OR ")})` : "false";
}

/**
 * Condition over a vehicle_types row `alias`: required words as prefixes of its indexed search text
 * ("y" finds "MODEL Y", not the "Y" inside "(5YJS)"), and any year in the query as a build year.
 */
export function vehicleTypeMatch(alias: string, parsed: ParsedSearch, bind: Bind) {
  const where: string[] = [];
  const query = prefixTsQuery(parsed);
  if (query) where.push(`to_tsvector('simple', search_normalize(${alias}.search_text)) @@ to_tsquery('simple', ${bind(query)})`);
  for (const year of parsed.years) where.push(`${bind(year)}::integer BETWEEN COALESCE(extract(year FROM ${alias}.year_of_constr_from), 0)
    AND COALESCE(extract(year FROM ${alias}.year_of_constr_to), 9999)`);
  return where.length ? where.join(" AND ") : "TRUE";
}

/** Same condition for the hand-entered store `products` table (small, unindexed). */
export function storeProductMatch(alias: string, parsed: ParsedSearch, bind: Bind, mode: SearchMode = "all") {
  const clauses: string[] = [];
  if (parsed.compact.length >= 3) clauses.push(`search_compact(${alias}.code) LIKE ${bind(`%${parsed.compact}%`)}`);
  const query = prefixTsQuery(parsed);
  if (mode === "all" && query) clauses.push(`to_tsvector('simple', search_normalize(concat_ws(' ', ${alias}.name, ${alias}.brand, ${alias}.code, ${alias}.description)))
    @@ to_tsquery('simple', ${bind(query)})`);
  return clauses.length ? `(${clauses.join(" OR ")})` : "false";
}

/** Relevance of a catalog-shaped row (name, brand, code, oem, description columns), highest first. */
export function catalogRank(alias: string, parsed: ParsedSearch, bind: Bind) {
  const columns = ["name", "brand", "code", "oem", "description"].map(column => `${alias}.${column}`).join(", ");
  return `catalog_search_rank(${columns}, to_tsquery('simple', ${bind(prefixTsQuery(parsed))}::text),
    to_tsquery('simple', ${bind(exactTsQuery(parsed))}::text), ${bind(parsed.compact)}::text)`;
}

/**
 * "Did you mean": after a search found nothing, swaps each word for the likeliest catalog word of
 * the scope — close in spelling and common, so a one-off typo in the data ("FIILTRESI") loses to
 * "FILTRESI". Below 0.45 similarity a match is noise ("qqzzvehicle" → "vehicle") rather than a typo
 * ("sitroen" → "citroen" is 0.45). Null when no word changes.
 */
export async function correctSearch(raw: string, scope: SearchScope, options: ParseOptions = {}) {
  const parsed = parseSearchQuery(raw, options);
  const words = parsed.terms.filter(term => term.required && /^[a-z]{3,}$/.test(term.text)).map(term => term.text);
  if (!words.length) return null;
  const { rows } = await db.query<{ term: string; word: string }>(`
    SELECT t.term, c.word FROM unnest($2::text[]) t(term)
    CROSS JOIN LATERAL (SELECT v.word FROM search_vocabulary v WHERE v.scope=$1 AND v.word % t.term
      AND similarity(v.word, t.term) >= 0.45
      ORDER BY similarity(v.word, t.term) * ln(2 + v.frequency) DESC, v.word LIMIT 1) c
    WHERE c.word <> t.term`, [scope, words]);
  if (!rows.length) return null;
  const replacements = new Map(rows.map(row => [row.term, row.word]));
  const text = [...parsed.terms.map(term => replacements.get(term.text) ?? term.text), ...parsed.years].join(" ");
  return { text, parsed: parseSearchQuery(text, options) };
}
