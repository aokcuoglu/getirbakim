// Turkish names of English supplier type names (#953). Suppliers list many products only under their TecDoc English
// name ("BRAKE DISC"); the store shows them as "Fren Diski" (src/modules/store/suggestion-names.ts), so a Turkish query
// should find them too. Pure (no server-only): the header search tests import it. Never import it from a client
// component: the dictionary stays on the server (query.ts is shared with the browser and must not import this).
import { typeNameEntries } from "@/modules/store/suggestion-names";
import { normalizeSearchText, prefixTsQuery, type ParsedSearch } from "./query";

/**
 * English words too ambiguous to search for as words, though the store may still translate them:
 * "cap" — also ÇAP and clutch-set noise (+1,981 rows for "kapak"); "arm" — VW engine code ARM; "spring" — the R9 SPRING
 * model; "plug" — PLUG-IN HIBRIT; "wheel" — 109 WHEEL BRAKE CYLINDER rows for "jant". Their Turkish name finds only the
 * products named exactly the word (typeNameExactQueries, #963).
 */
const ambiguousEnglish = new Set(["cap", "arm", "spring", "plug", "wheel"]);
const longestWindow = 5;
const maxQueries = 4;

// Turkish possessive/plural endings and the final consonant they soften ("kapağı" → "kapak"), as in query.ts.
const endings = ["lari", "leri", "lar", "ler", "si", "su", "i", "u"];
const hardened: Record<string, string> = { g: "k", b: "p", d: "t" };

/**
 * A word and each form of it without a Turkish ending, if at least `shortest` letters stay, with the softened final
 * consonant hardened back: "kapagi" → kapagi, kapag, kapak. Words with a digit stay as they are. A dictionary word and a
 * query word name the same thing when their roots meet. The dictionary side keeps four letters, like phraseKey, so a
 * name still matches every query it matched by key; the query side keeps three, so "cami", "mili", "fari" and "kolu"
 * reach Cam, Mil, Far and Kol ("kap" and "kabi" reach nothing: no name is "kap").
 */
function roots(word: string, shortest: number) {
  if (/\d/.test(word)) return new Set([word]);
  const found = new Set([word]);
  for (const ending of endings) {
    if (!word.endsWith(ending) || word.length - ending.length < shortest) continue;
    const stem = word.slice(0, -ending.length);
    found.add(stem);
    const hard = hardened[stem.at(-1)!];
    if (hard) found.add(stem.slice(0, -1) + hard);
  }
  return found;
}

/** A Turkish name as the roots of each word, with the English name (folded words joined by one space) it translates. */
type Entry = { words: Set<string>[]; english: string };
const entries: Entry[] = [];
/** The ambiguous English names, matched only as a whole name. */
const exactEntries: Entry[] = [];
// English keys are normalized too: they go into to_tsquery quoted, so they must stay [a-z0-9] words (tested).
for (const [name, turkish] of typeNameEntries()) {
  const english = normalizeSearchText(name);
  const normalized = normalizeSearchText(turkish);
  if (english === normalized) continue;
  (ambiguousEnglish.has(english) ? exactEntries : entries).push({ words: normalized.split(" ").map(word => roots(word, 4)), english });
}

/** The English names whose Turkish name the query words spell, word by word with any ending, in dictionary order. */
function englishNames(list: Entry[], words: string[]) {
  const queryRoots = words.map(word => roots(word, 3));
  const names = list.filter(entry => entry.words.length === words.length
    && entry.words.every((options, index) => [...queryRoots[index]].some(root => options.has(root))));
  return [...new Set(names.map(entry => entry.english))];
}

/**
 * Runs of query words (terms `start`..`end`) that name English supplier names in Turkish, longest first. Codes ("5W-40")
 * break a run. A single word whose English name is already one of its spellings ("kayış" → belt) adds nothing.
 */
function typeNameWindows(parsed: ParsedSearch) {
  const windows: { start: number; end: number; english: string[] }[] = [];
  const { terms } = parsed;
  for (let start = 0; start < terms.length; start++) {
    let words: string[] = [];
    for (let end = start; end < terms.length && !terms[end].parts; end++) {
      words = [...words, ...terms[end].text.split(" ")];
      if (words.length > longestWindow) break;
      let english = englishNames(entries, words);
      if (end === start) english = english.filter(name => !terms[start].alternatives.some(alternative => alternative.value === name));
      if (english.length) windows.push({ start, end, english });
    }
  }
  return windows.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
}

const phrase = (english: string) => english.split(" ").map(word => `'${word}'`).join(" <-> ");

/**
 * Extra tsqueries for the English supplier names a run of query words names in Turkish, each with the other required
 * words: "fren diski bosch" → `('brake' <-> 'disc') & ('bosch':*)`, "motor kapağı" → `('cover') & ('motor':*)`.
 * Longest runs first, at most four.
 */
export function typeNameTsQueries(parsed: ParsedSearch): string[] {
  const { terms } = parsed;
  const queries = typeNameWindows(parsed).map(({ start, end, english }) => {
    const others = prefixTsQuery({ ...parsed, terms: terms.filter((_, index) => index < start || index > end) });
    const names = `(${english.map(phrase).join(" | ")})`;
    return others ? `${names} & ${others}` : names;
  });
  return [...new Set(queries)].slice(0, maxQueries);
}

/**
 * Whole-name matches for the ambiguous English words (#963): a query word naming one in Turkish ("kapak", "kapağı" → CAP)
 * finds the supplier rows whose name is exactly that word, with the other required words. `query` keeps the word in the
 * tsquery so the text index still picks the rows; the caller rechecks the name against `names` (folded, as search_normalize).
 */
export function typeNameExactQueries(parsed: ParsedSearch): { names: string[]; query: string }[] {
  const { terms } = parsed;
  const matches = terms.flatMap((term, index) => {
    if (term.parts) return [];
    const names = englishNames(exactEntries, term.text.split(" "));
    if (!names.length) return [];
    const others = prefixTsQuery({ ...parsed, terms: terms.filter((_, other) => other !== index) });
    const words = `(${names.map(name => `'${name}'`).join(" | ")})`;
    return [{ names, query: others ? `${words} & ${others}` : words }];
  });
  return matches.slice(0, maxQueries);
}

/**
 * A row the expansion found by its English name ranks as if it carried the Turkish name typed (#969): `query` (the English
 * names as name words, weight A) picks those rows, whose stored document loses the `english` words and gains `turkish` as
 * name words before ranking. `names`: an ambiguous word, only for rows named exactly one of these.
 */
export type TypeNameBoost = { query: string; english: string[]; turkish: string; names?: string[] };

/** The ranking swaps for the type names a query spells in Turkish ("fren diski" → BRAKE DISC), longest runs first, at most four. */
export function typeNameRankBoosts(parsed: ParsedSearch): TypeNameBoost[] {
  const { terms } = parsed;
  const typed = (start: number, end: number) => terms.slice(start, end + 1).map(term => term.text).join(" ");
  const boosts: TypeNameBoost[] = typeNameWindows(parsed).map(({ start, end, english }) => ({
    query: `(${english.map(name => name.split(" ").map(word => `'${word}':A`).join(" <-> ")).join(" | ")})`,
    english: [...new Set(english.flatMap(name => name.split(" ")))],
    turkish: typed(start, end),
  }));
  terms.forEach((term, index) => {
    if (term.parts) return;
    const names = englishNames(exactEntries, term.text.split(" "));
    if (names.length) boosts.push({ query: `(${names.map(name => `'${name}':A`).join(" | ")})`, english: names, turkish: typed(index, index), names });
  });
  return boosts.slice(0, maxQueries);
}
