// Turkish names of English supplier type names (#953). Suppliers list many products only under their TecDoc English
// name ("BRAKE DISC"); the store shows them as "Fren Diski" (src/modules/store/suggestion-names.ts), so a Turkish query
// should find them too. Pure (no server-only): the header search tests import it. Never import it from a client
// component: the dictionary stays on the server (query.ts is shared with the browser and must not import this).
import { typeNameEntries } from "@/modules/store/suggestion-names";
import { normalizeSearchText, phraseKey, prefixTsQuery, type ParsedSearch } from "./query";

/**
 * English words too ambiguous to search for as words, though the store may still translate them:
 * "cap" — also ÇAP and clutch-set noise (+1,981 rows for "kapak"); "arm" — VW engine code ARM; "spring" — the R9 SPRING
 * model; "plug" — PLUG-IN HIBRIT; "wheel" — 109 WHEEL BRAKE CYLINDER rows for "jant". Their Turkish name finds only the
 * products named exactly the word (typeNameExactQueries, #963).
 */
const ambiguousEnglish = new Set(["cap", "arm", "spring", "plug", "wheel"]);
const longestWindow = 5;
const maxQueries = 4;

/** phraseKey of the Turkish name → English names (folded words joined by one space), in dictionary order. */
const englishByTurkish = new Map<string, string[]>();
/** phraseKey of the Turkish name → the ambiguous English names it translates, matched only as a whole name. */
const exactEnglishByTurkish = new Map<string, string[]>();
// English keys are normalized too: they go into to_tsquery quoted, so they must stay [a-z0-9] words (tested).
// Known limit: a suffixed form whose stem differs from the name ("kapağı", "camı", "mili") is not matched.
for (const [name, turkish] of typeNameEntries()) {
  const english = normalizeSearchText(name);
  const normalized = normalizeSearchText(turkish);
  if (english === normalized) continue;
  const key = phraseKey(normalized.split(" "));
  const target = ambiguousEnglish.has(english) ? exactEnglishByTurkish : englishByTurkish;
  target.set(key, [...target.get(key) ?? [], english]);
}

const phrase = (english: string) => english.split(" ").map(word => `'${word}'`).join(" <-> ");

/**
 * Extra tsqueries for the English supplier names a run of query words names in Turkish, each with the other required
 * words: "fren diski bosch" → `('brake' <-> 'disc') & ('bosch':*)`. Codes ("5W-40") break a run. A single word whose
 * English name is already one of its spellings ("kayış" → belt) adds nothing. Longest runs first, at most four.
 */
export function typeNameTsQueries(parsed: ParsedSearch): string[] {
  const windows: { start: number; end: number; english: string[] }[] = [];
  const { terms } = parsed;
  for (let start = 0; start < terms.length; start++) {
    let words: string[] = [];
    for (let end = start; end < terms.length && !terms[end].parts; end++) {
      words = [...words, ...terms[end].text.split(" ")];
      if (words.length > longestWindow) break;
      let english = englishByTurkish.get(phraseKey(words)) ?? [];
      if (end === start) english = english.filter(name => !terms[start].alternatives.some(alternative => alternative.value === name));
      if (english.length) windows.push({ start, end, english });
    }
  }
  windows.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const queries = windows.map(({ start, end, english }) => {
    const others = prefixTsQuery({ ...parsed, terms: terms.filter((_, index) => index < start || index > end) });
    const names = `(${english.map(phrase).join(" | ")})`;
    return others ? `${names} & ${others}` : names;
  });
  return [...new Set(queries)].slice(0, maxQueries);
}

/**
 * Whole-name matches for the ambiguous English words (#963): a query word naming one in Turkish ("kapak" → CAP) finds the
 * supplier rows whose name is exactly that word, with the other required words. `query` keeps the word in the tsquery so
 * the text index still picks the rows; the caller rechecks the name against `names` (folded, as search_normalize).
 */
export function typeNameExactQueries(parsed: ParsedSearch): { names: string[]; query: string }[] {
  const { terms } = parsed;
  const matches = terms.flatMap((term, index) => {
    if (term.parts) return [];
    const names = exactEnglishByTurkish.get(phraseKey(term.text.split(" ")));
    if (!names) return [];
    const others = prefixTsQuery({ ...parsed, terms: terms.filter((_, other) => other !== index) });
    const words = `(${names.map(name => `'${name}'`).join(" | ")})`;
    return [{ names, query: others ? `${words} & ${others}` : words }];
  });
  return matches.slice(0, maxQueries);
}
