// Turkish names of English supplier type names (#953). Suppliers list many products only under their TecDoc English
// name ("BRAKE DISC"); the store shows them as "Fren Diski" (src/modules/store/suggestion-names.ts), so a Turkish query
// should find them too. Pure (no server-only): the header search tests import it. Never import it from a client
// component: the dictionary stays on the server (query.ts is shared with the browser and must not import this).
import { typeNameEntries } from "@/modules/store/suggestion-names";
import { normalizeSearchText, phraseKey, prefixTsQuery, type ParsedSearch } from "./query";

/**
 * English words too ambiguous to search for, though the store may still translate them:
 * "cap" — also ÇAP and clutch-set noise (+1,981 rows for "kapak"); "arm" — VW engine code ARM; "spring" — the R9 SPRING
 * model; "plug" — PLUG-IN HIBRIT; "wheel" — 109 WHEEL BRAKE CYLINDER rows for "jant". The cost: the 117 products named
 * exactly one of these are not found by their Turkish name.
 */
const ambiguousEnglish = new Set(["cap", "arm", "spring", "plug", "wheel"]);
const longestWindow = 5;
const maxQueries = 4;

/** phraseKey of the Turkish name → English names (folded words joined by one space), in dictionary order. */
const englishByTurkish = new Map<string, string[]>();
for (const [english, turkish] of typeNameEntries()) {
  const normalized = normalizeSearchText(turkish);
  if (english === normalized || ambiguousEnglish.has(english)) continue;
  const key = phraseKey(normalized.split(" "));
  englishByTurkish.set(key, [...englishByTurkish.get(key) ?? [], english]);
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
