import "server-only";
import { db } from "@/lib/db";
import { compactSearchCode, exactTsQuery, parseSearchQuery, prefixTsQuery, type ParsedSearch, type ParseOptions } from "./query";
import { typeNameExactQueries, typeNameRankBoosts, typeNameTsQueries } from "./type-names";

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
  // English supplier names of Turkish type names ("fren diski" → BRAKE DISC, #953): separate clauses, because a <-> phrase
  // inside the main tsquery forces a recheck of every hit (200 ms against 57 ms as an OR of index scans).
  if (mode === "all") for (const names of typeNameTsQueries(parsed))
    clauses.push(`to_tsvector('simple', supplier_item_search_text(${alias}.code, ${alias}.product_data)) @@ to_tsquery('simple', ${bind(names)})`);
  // Ambiguous ones ("kapak" → CAP, never ÇAP or CAP 276, #963): the word through the same index, the whole name rechecked on
  // those few rows only. As an id list through the primary key: a plain AND here would leave the name test outside the
  // index scans, and the whole OR would be refiltered on every hit (550 ms against 38 ms for "kapak").
  if (mode === "all") for (const { names, query: words } of typeNameExactQueries(parsed))
    clauses.push(`${alias}.id = ANY(ARRAY(SELECT x.id FROM supplier_items x
      WHERE to_tsvector('simple', supplier_item_search_text(x.code, x.product_data)) @@ to_tsquery('simple', ${bind(words)})
        AND search_normalize(x.product_data->>'ac') = ANY(${bind(names)}::text[])))`);
  return clauses.length ? `(${clauses.join(" OR ")})` : "false";
}

/**
 * Condition over an enrichment_product_states row `alias` (/yonetim/urun-verileri search, #617): its supplier item
 * matches like the storefront, or its manufacturer part number or one of its enrichment's OEM numbers holds the code.
 * Each branch is an indexed id set (db/search.sql, db/enrichment-search.sql) reached through the primary key; as an
 * OR over joined rows the same test computed the search text of every row of the tab (6 s complete, 21 s pending).
 */
export function enrichmentStateMatch(alias: string, parsed: ParsedSearch, bind: Bind) {
  const sets = [`SELECT x.product_id FROM enrichment_product_states x
    WHERE x.supplier_item_id IN (SELECT s.id FROM supplier_items s WHERE ${supplierItemMatch("s", parsed, bind)})`];
  // compact is [a-z0-9] only, so it needs no LIKE escaping.
  if (parsed.compact.length >= 3) {
    const key = bind(`%${parsed.compact}%`);
    sets.push(`SELECT x.product_id FROM enrichment_product_states x
      WHERE x.manufacturer_part_number IS NOT NULL AND search_compact(x.manufacturer_part_number) LIKE ${key}`,
    // Only an enriched row reads its enrichment. The key has no space, so a hit in the space-separated text lies inside one number.
    `SELECT x.product_id FROM product_enrichments e JOIN enrichment_product_states x ON x.supplier_item_id=e.supplier_item_id AND x.enriched
      WHERE enrichment_oem_search(e.payload) LIKE ${key}`);
  }
  return `${alias}.product_id IN (${sets.join(" UNION ALL ")})`;
}

// Turkish letters a normalized (ASCII) query letter stands for; ~* covers the ASCII case pair.
const turkishVariants: Record<string, string> = { c: "cçÇ", g: "gğĞ", i: "iıİ", o: "oöÖ", s: "sşŞ", u: "uüÜ" };
// An optional separator inside a code: "5W40" also finds "5W-40", "5W 40" and "5W/40".
const codeSeparator = "[-/ ]?";
/** Normalized words are [a-z0-9.] only: "." is the one regex metacharacter to escape. Letter↔digit boundaries may hold a separator. */
function dinamikWordPattern(word: string) {
  return [...word].map((char, index) => {
    const pattern = char === "." ? "\\." : turkishVariants[char] ? `[${turkishVariants[char]}]` : char;
    const boundary = index > 0 && /^(?:[a-z]\d|\d[a-z])$/.test(word[index - 1] + char);
    return boundary ? codeSeparator + pattern : pattern;
  }).join("");
}

/**
 * Dinamik rows keep their own field names (stokAdi, oemListe…), which the indexed supplier text above does not read.
 * Every word must start a word in name, code, OEM/equivalent lists or part type ("on" finds "ON FREN", not
 * "FRONTERA"); the part-number branch uses the shared trigram index. Folding sits in the pattern, so the row text
 * is read as is: one regex per row stays ~0.3 s over ~1M rows (per-row search_normalize took ~6 s).
 */
export function dinamikItemMatch(alias: string, raw: string, bind: Bind) {
  const words = parseSearchQuery(raw).terms.slice(0, 8);
  const text = `concat_ws(' ',${alias}.product_data->>'stokAdi',${alias}.code,${alias}.product_data->>'oemListe',${alias}.product_data->>'esdegerListe',${alias}.product_data->>'kull8s')`;
  // A synonym phrase ("sogutma sivisi") needs each of its words, like separate query words did.
  const pattern = words.flatMap(word => word.parts ? [word.parts.map(dinamikWordPattern).join(codeSeparator)] : word.text.split(" ").map(dinamikWordPattern))
    .map(word => `(?=.*\\m${word})`).join("");
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

/**
 * Supplier rows whose admin-edited name, description, store brand or part number (commerce_item_overrides, #575/#602)
 * matches: the stored search text of a row is the supplier's, so a renamed product is found by its new name here, and
 * an edited part number with any spacing (code searches too). The supplier's own name, brand and code keep finding the
 * row through the stored fields. Rows whose supplier OEM field is hidden (#615) are left out of those stored fields by
 * the storefront search (src/modules/store/catalog.ts), so they match here on their text and code without the OEM.
 * The table holds only edited rows, so it is read whole. Null when neither applies.
 */
export function overrideItemMatch(parsed: ParsedSearch, bind: Bind, mode: SearchMode = "all") {
  const clauses: string[] = [];
  const query = prefixTsQuery(parsed);
  if (mode === "all" && query) clauses.push(`((o.name IS NOT NULL OR o.description IS NOT NULL OR o.brand IS NOT NULL OR o.part_number IS NOT NULL OR o.hide_oem)
    AND to_tsvector('simple', search_normalize(concat_ws(' ', COALESCE(o.name, NULLIF(s.product_data->>'ac', ''), s.code),
      s.product_data->>'ac', s.product_data->>'uk', s.code, CASE WHEN o.hide_oem THEN NULL ELSE s.product_data->>'oe' END,
      s.product_data->>'ac2', o.description, o.brand, o.part_number))) @@ to_tsquery('simple', ${bind(query)}))`);
  // compact is [a-z0-9] only, so it needs no LIKE escaping.
  if (parsed.compact.length >= 3) {
    const key = bind(`%${parsed.compact}%`);
    clauses.push(`(o.part_number IS NOT NULL AND search_compact(o.part_number) LIKE ${key})`, `(o.hide_oem AND search_compact(s.code) LIKE ${key})`);
  }
  if (!clauses.length) return null;
  return `SELECT o.supplier_item_id FROM commerce_item_overrides o JOIN supplier_items s ON s.id = o.supplier_item_id
    WHERE ${clauses.join(" OR ")}`;
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

/**
 * Relevance of a supplier row `alias` from its stored ranking inputs (search_doc, search_code, search_oem; db/search.sql).
 * `queries`: the prefix tsquery, exact tsquery and compact code arguments of catalog_search_rank_doc.
 *
 * A row found only by the English supplier name of a Turkish query ("fren diski" → BRAKE DISC, #953) would rank far
 * below the rows named in Turkish: its stored document holds none of the typed words. Such a row ranks as if it carried
 * the typed Turkish name instead (#969): the English name words leave its document and the typed words join it as name
 * words, so it ranks like the same row named "Fren Diski". Ranked at query time, so the stored documents need no
 * reindex; GREATEST, so no row ranks lower than before; only rows holding the English name pay for the second rank.
 * A fixed boost (or the best of an English-query rank) put every English-named row above every Turkish one (#969).
 */
export function storedRank(alias: string, parsed: ParsedSearch, bind: Bind, queries: string) {
  const base = `catalog_search_rank_doc(${alias}.search_doc, ${alias}.search_code, ${alias}.search_oem, ${queries})`;
  const boosts = typeNameRankBoosts(parsed);
  if (!boosts.length) return base;
  const swapped = boosts.map(boost => {
    const name = boost.names ? ` AND search_normalize(${alias}.product_data->>'ac') = ANY(${bind(boost.names)}::text[])` : "";
    return `CASE WHEN ${alias}.search_doc @@ to_tsquery('simple', ${bind(boost.query)}::text)${name}
      THEN catalog_search_rank_doc(ts_delete(${alias}.search_doc, ${bind(boost.english)}::text[])
        || setweight(to_tsvector('simple', ${bind(boost.turkish)}::text), 'A'), ${alias}.search_code, ${alias}.search_oem, ${queries}) END`;
  });
  return `GREATEST(${base}, ${swapped.join(", ")})`;
}

/**
 * Relevance of a catalog-shaped row (name, brand, code, oem, description, display_brand, display_code columns), highest
 * first. Keep in step with summarizeSearch (src/modules/store/catalog.ts).
 */
export function catalogRank(alias: string, parsed: ParsedSearch, bind: Bind) {
  const queries = `to_tsquery('simple', ${bind(prefixTsQuery(parsed))}::text), to_tsquery('simple', ${bind(exactTsQuery(parsed))}::text), ${bind(parsed.compact)}::text`;
  const rank = (code: string) => `catalog_search_rank(${[`${alias}.name`, `${alias}.display_brand`, `${alias}.${code}`, `${alias}.oem`, `${alias}.description`].join(", ")}, ${queries})`;
  // Supplier rows rank their stored inputs (db/search.sql trigger): ~6 normalisations fewer per row, which
  // turned a 23k-match search from ~0.8 s of ranking into a primary-key lookup each. Store products, and
  // any row the trigger has not filled yet, compute the same values on the fly. So do rows with an admin-edited name,
  // description, store brand or part number (#575, #602): the stored inputs are the supplier's, the view columns carry
  // the edit (a price edit, #580, does not). An edited part number ranks like the supplier code it stands beside: the
  // better of the two, so an exact match of either ranks first. A row whose supplier OEM field is hidden (#615) ranks
  // on the computed path too: its view oem is empty, the stored search_oem is not. The stored inputs carry the supplier's
  // brand label, the computed path the shown brand (display_brand: the master brand name, #811).
  return `COALESCE((SELECT ${storedRank("s", parsed, bind, queries)}
    FROM supplier_items s WHERE s.id = ${alias}.id AND s.search_doc IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM commerce_item_overrides o WHERE o.supplier_item_id = s.id
        AND (o.name IS NOT NULL OR o.description IS NOT NULL OR o.brand IS NOT NULL OR o.part_number IS NOT NULL OR o.hide_oem))),
    CASE WHEN ${alias}.display_code <> ${alias}.code THEN GREATEST(${rank("code")}, ${rank("display_code")}) ELSE ${rank("code")} END)`;
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
