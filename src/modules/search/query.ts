// Query side of the shared search engine (db/search.sql is the document side).
// Pure and isomorphic: the same parsing serves vehicles, storefront products and admin lists.

const foldFrom = "ÇĞİÖŞÜÂÎÛÊÄËÏÉÈÀÁÓÒÍÚÑçğıöşüâîûêäëïéèàáóòíúñ";
const foldTo = "cgiosuaiueaeieeaaooiuncgiosuaiueaeieeaaooiun";
const fold = new Map([...foldFrom].map((char, index) => [char, foldTo[index]]));

/** Mirrors SQL search_normalize: ASCII-folded lower case, punctuation as spaces, "1,6" → "1.6". */
export function normalizeSearchText(value: string) {
  // NFC first: macOS and some keyboards send "ö" as "o" + combining diaeresis.
  return [...value.normalize("NFC")].map(char => fold.get(char) ?? char).join("").toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.]+|(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Fewer letters and digits than this match too much to be useful ("a" lists 50k products, "y" every vehicle). */
export const minSearchLength = 2;
export function searchTooShort(raw: string) {
  return compactSearchCode(raw.slice(0, 120)).length < minSearchLength;
}

/** Mirrors SQL search_compact: part and OEM numbers without separators. */
export function compactSearchCode(value: string) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, "");
}

/**
 * One accepted spelling of a query word; `prefix` also matches longer words ("fren" → "frenler").
 * A value with a space is a phrase of adjacent words ("320 d").
 */
/** `loose`: the words of `value` anywhere in the text, each as a prefix when `prefix` ("sogutma sivi" finds "SIVISI SOGUTMA"). */
export type SearchAlternative = { value: string; prefix: boolean; synonym?: boolean; loose?: boolean };
/** A query word. Required words must all match; optional ones only improve the ranking. */
/** `text` holds a space for a multi-word synonym phrase ("sogutma sivisi"). `parts`: a code typed with separators ("5W-40" → ["5w", "40"]); `text` is then the parts joined ("5w40"). */
export type SearchTerm = { text: string; alternatives: SearchAlternative[]; required: boolean; parts?: string[] };
export type ParsedSearch = { terms: SearchTerm[]; compact: string; years: number[] };
/** `years`: read 4-digit years as a build-year filter (vehicle search) instead of as words. */
export type ParseOptions = { years?: boolean };

// Filler words people add around model names ("bmw 3 serisi", "tesla model y").
const optionalWords = new Set(["model", "seri", "serisi", "series", "sinif", "sinifi", "class", "klasse",
  "arac", "araba", "oto", "otomobil", "icin", "ve", "ile", "for", "the"]);

// Spellings that should find each other, both ways (all keys normalised). An entry may be a phrase: a query
// holding its words in a row ("soğutma sıvısı") reads as one term. A word may sit in several groups.
const synonymGroups = [
  ["dizel", "diesel", "mazot", "motorin"], ["benzin", "benzinli", "petrol", "gasoline"], ["elektrik", "elektrikli", "electric"],
  ["hibrit", "hybrid"], ["vw", "volkswagen"], ["mercedes", "mb"], ["chevrolet", "chevy"],
  ["filtre", "filter"], ["yag", "oil"], ["fren", "brake"], ["balata", "pad"], ["aku", "akumulator", "battery"],
  ["silecek", "wiper"], ["ampul", "bulb"], ["amortisor", "shock"], ["kayis", "belt"], ["rulman", "bilya", "bearing"],
  ["pompa", "pump"], ["ayna", "mirror"], ["far", "headlight"], ["buji", "spark"], ["radyator", "radiator", "petek"],
  // Auto-parts names the supplier catalogs spell or call differently (word counts from search_vocabulary).
  ["egzoz", "egsoz", "eksoz"], ["enjektor", "injektor"], ["devirdaim", "devridaim", "su pompasi"],
  ["debriyaj", "kavrama"], ["alternator", "sarj dinamosu", "dinamo"], ["mars motoru", "starter"],
  ["antifriz", "sogutma sivisi"], ["polen filtresi", "kabin filtresi", "klima filtresi"],
  ["mazot filtresi", "yakit filtresi", "dizel filtresi", "motorin filtresi"], ["benzin filtresi", "yakit filtresi"],
  ["yakit pompasi", "benzin pompasi"], ["lambda", "oksijen sensoru"], ["partikul filtresi", "dpf"],
  ["rot basi", "rot ucu", "rot kafasi"], ["salincak", "tabla"], ["kizdirma bujisi", "isitma bujisi"],
  ["vantilator", "fan"], ["kardan", "saft"], ["baski balata", "debriyaj seti", "kavrama seti"],
  ["motor takozu", "motor kulagi"], ["triger kayisi", "eksantrik kayisi", "zamanlama kayisi"], ["triger seti", "eksantrik seti"],
  // Turkish market names of models TecDoc lists under their European name.
  ["egea", "tipo"], ["symbol", "thalia"], ["albea", "siena"],
  // Spelled as pronounced, too far from the make for spelling correction.
  ["renault", "reno"], ["peugeot", "pejo", "pejot"],
];
const romans = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

const softening: Record<string, string> = { g: "k", b: "p", d: "t" };
// Turkish possessive/plural endings: "balatasi" → "balata", "filtreler" → "filtre", "kapagi" → "kapak".
function stems(word: string) {
  if (/\d/.test(word)) return [];
  const suffix = ["lari", "leri", "lar", "ler", "si", "su", "i", "u"].find(end => word.endsWith(end) && word.length - end.length >= 4);
  if (!suffix) return [];
  const stem = word.slice(0, -suffix.length);
  const softened = softening[stem.at(-1)!];
  return softened ? [stem, stem.slice(0, -1) + softened] : [stem];
}

/**
 * Every spelling of a letter/digit code split at its letter↔digit boundaries ("5w40" → "5 w40", "5w 40",
 * "5 w 40"; "320d" → "320 d"): catalogs write the same code joined, spaced or hyphenated, and the index keeps
 * "5W40" as one word but "5W-40" as two. Beyond four runs only the fully split form is added.
 */
export function codeSpellings(word: string) {
  if (!/^[a-z0-9]+$/.test(word) || !/[a-z]/.test(word) || !/\d/.test(word)) return [];
  const runs = word.match(/[a-z]+|\d+/g)!;
  if (runs.length > 4) return [runs.join(" ")];
  const spellings: string[] = [];
  for (let mask = 1; mask < 1 << (runs.length - 1); mask++)
    spellings.push(runs.map((run, index) => index && mask & (1 << (index - 1)) ? ` ${run}` : run).join(""));
  return spellings;
}

/**
 * Query words, with codes typed with separators kept together as one word's parts: "5W-40", "5W/40", "C-200",
 * and a viscosity typed with a space ("5w 40"). Only parts with a digit join: "ön-arka" stays two words.
 */
function queryWords(raw: string): string[][] {
  const words: string[][] = [];
  for (const chunk of raw.replace(/(\d),(\d)/g, "$1.$2").split(/[\s,;:()[\]{}"'+&|*!?]+/)) {
    const parts = normalizeSearchText(chunk).split(" ").filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4 && parts.every(part => /^[a-z0-9]+$/.test(part)) && parts.some(part => /\d/.test(part))) words.push(parts);
    else words.push(...parts.map(part => [part]));
  }
  // "5w 40", "10w 30": a viscosity grade typed with a space.
  for (let index = words.length - 1; index > 0; index--) {
    const [before, after] = [words[index - 1], words[index]];
    if (before.length === 1 && after.length === 1 && /^\d{1,2}w$/.test(before[0]) && /^\d{2}$/.test(after[0])) words.splice(index - 1, 2, [before[0], after[0]]);
  }
  return words;
}

/** A word without its Turkish ending, so "sıvısı" and "sıvı", "filtreleri" and "filtre" compare equal. */
const stemKey = (word: string) => stems(word)[0] ?? word;
const phraseKey = (words: string[]) => words.map(stemKey).join(" ");

// Keyed by phraseKey: the stemmed words of each other spelling. A group shares a word's map entry with every other group holding it.
let synonyms = new Map<string, Set<string>>();
let longestPhrase = 1;
function buildSynonyms(groups: string[][]) {
  const map = new Map<string, Set<string>>();
  for (const group of groups) for (const entry of group) {
    const key = phraseKey(entry.split(" "));
    const others = map.get(key) ?? new Set<string>();
    for (const other of group) if (other !== entry) others.add(other.includes(" ") ? phraseKey(other.split(" ")) : other);
    map.set(key, others);
  }
  synonyms = map;
  longestPhrase = Math.max(1, ...groups.flat().map(entry => entry.split(" ").length));
}
buildSynonyms(synonymGroups);

/** The built-in synonym groups (read-only on /yonetim/arama). */
export const builtInSynonymGroups: readonly (readonly string[])[] = synonymGroups;
/** Normalizes an admin-entered spelling the way queries are read: "Soğutma Sıvısı" → "sogutma sivisi". */
export function normalizeSynonym(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean).slice(0, 4).join(" ");
}
/** Adds admin-managed groups (search_synonyms, loaded by src/modules/search/custom-synonyms.ts) to the built-in ones. */
export function setCustomSynonymGroups(groups: string[][]) {
  buildSynonyms([...synonymGroups, ...groups.map(group => group.map(normalizeSynonym).filter(Boolean)).filter(group => group.length >= 2)]);
}

/** Synonyms of a word or phrase; a phrase synonym is loose (its words anywhere, as prefixes). */
function synonymAlternatives(key: string): SearchAlternative[] {
  return [...synonyms.get(key) ?? []].map(value => ({ value, prefix: true, synonym: true, ...(value.includes(" ") ? { loose: true } : {}) }));
}

/** Single words joined into the longest synonym phrase starting at each position ("sogutma", "sivisi" → one term). */
function withPhrases(words: string[][]): string[][] {
  const result: string[][] = [];
  for (let index = 0; index < words.length; index++) {
    let length = Math.min(longestPhrase, words.length - index);
    for (; length >= 2; length--) {
      const slice = words.slice(index, index + length);
      if (slice.every(word => word.length === 1) && synonyms.has(phraseKey(slice.map(word => word[0])))) break;
    }
    if (length >= 2) { result.push([words.slice(index, index + length).map(word => word[0]).join(" ")]); index += length - 1; }
    else result.push(words[index]);
  }
  return result;
}

export function parseSearchQuery(raw: string, options: ParseOptions = {}): ParsedSearch {
  const years: number[] = [];
  const terms: SearchTerm[] = [];
  const seen = new Set<string>();
  for (const parts of withPhrases(queryWords(raw.slice(0, 120)))) {
    const word = parts.join("");
    if (seen.has(word)) continue;
    seen.add(word);
    if (word.includes(" ")) {
      const key = phraseKey(word.split(" "));
      terms.push({ text: word, alternatives: [{ value: key, prefix: true, loose: true }, ...synonymAlternatives(key)], required: true });
      continue;
    }
    if (parts.length > 1) {
      const spellings = [...new Set([parts.join(" "), word, ...codeSpellings(word)])];
      terms.push({ text: word, parts, alternatives: spellings.map(value => ({ value, prefix: true })), required: true });
      continue;
    }
    const year = Number(word);
    if (options.years && /^\d{4}$/.test(word) && year >= 1950 && year <= new Date().getFullYear() + 1) { years.push(year); continue; }
    const number = Number(word);
    const smallNumber = /^\d{1,2}$/.test(word) && number >= 1 && number <= 10;
    // "golf 7" means the seventh generation, not every "75 hp" variant: model numbers match whole.
    const alternatives: SearchAlternative[] = [{ value: word, prefix: !smallNumber }];
    for (const stem of stems(word)) alternatives.push({ value: stem, prefix: true });
    alternatives.push(...synonymAlternatives(stemKey(word)));
    // "320d", "c200", "5w40": TecDoc writes engine and model codes apart ("320 d", "C 200"), oils "5W-40".
    for (const value of codeSpellings(word)) alternatives.push({ value, prefix: true });
    // "golf 7" finds "GOLF VII"; the numeral stays exact so "v" does not also match "vii".
    if (smallNumber) alternatives.push({ value: romans[number - 1], prefix: false });
    const roman = romans.indexOf(word);
    if (roman >= 0) alternatives.push({ value: String(roman + 1), prefix: false });
    terms.push({ text: word, alternatives, required: !optionalWords.has(word) });
  }
  // A query made only of filler words still has to match something.
  if (terms.length && terms.every(term => !term.required)) for (const term of terms) term.required = true;
  return { terms, compact: compactSearchCode(raw.slice(0, 120)), years };
}

// Values are [a-z0-9. ] after normalisation, so quoting needs no escaping.
/** The same query without translated words ("fren" no longer also means "brake"). */
export function withoutSynonyms(parsed: ParsedSearch): ParsedSearch {
  return { ...parsed, terms: parsed.terms.map(term => ({ ...term, alternatives: term.alternatives.filter(alternative => !alternative.synonym) })) };
}

/** The same query matching whole words only ("hava" no longer finds "HAVAL"). */
export function wholeWords(parsed: ParsedSearch): ParsedSearch {
  return { ...parsed, terms: parsed.terms.map(term => ({ ...term, alternatives: term.alternatives.map(a => ({ ...a, prefix: false })) })) };
}

const lexeme = (value: string, prefix = false, loose = false) => loose
  ? `(${value.split(" ").map(part => `'${part}'${prefix ? ":*" : ""}`).join(" & ")})`
  : value.split(" ").map(part => `'${part}'`).join(" <-> ") + (prefix ? ":*" : "");

/** All required words, each as an OR of its spellings: `'tesla':* & ('y':*)`. Null when nothing is required. */
export function prefixTsQuery(parsed: ParsedSearch) {
  const required = parsed.terms.filter(term => term.required);
  if (!required.length) return null;
  return required.map(term => `(${term.alternatives.map(a => lexeme(a.value, a.prefix, a.loose)).join(" | ")})`).join(" & ");
}

/** Any spelling of any query word as a whole word, for ranking exact hits above prefix hits. */
export function exactTsQuery(parsed: ParsedSearch) {
  if (!parsed.terms.length) return null;
  return [...new Set(parsed.terms.flatMap(term => term.alternatives.map(a => lexeme(a.value, false, a.loose))))].join(" | ");
}

