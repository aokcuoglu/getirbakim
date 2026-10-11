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

/** Mirrors SQL search_compact: part and OEM numbers without separators. */
export function compactSearchCode(value: string) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, "");
}

/**
 * One accepted spelling of a query word; `prefix` also matches longer words ("fren" → "frenler").
 * A value with a space is a phrase of adjacent words ("320 d").
 */
export type SearchAlternative = { value: string; prefix: boolean };
/** A query word. Required words must all match; optional ones only improve the ranking. */
export type SearchTerm = { text: string; alternatives: SearchAlternative[]; required: boolean };
export type ParsedSearch = { terms: SearchTerm[]; compact: string; years: number[] };
/** `years`: read 4-digit years as a build-year filter (vehicle search) instead of as words. */
export type ParseOptions = { years?: boolean };

// Filler words people add around model names ("bmw 3 serisi", "tesla model y").
const optionalWords = new Set(["model", "seri", "serisi", "series", "sinif", "sinifi", "class", "klasse",
  "arac", "araba", "oto", "otomobil", "icin", "ve", "ile", "for", "the"]);

// Spellings that should find each other, both ways (all keys normalised).
const synonymGroups = [
  ["dizel", "diesel"], ["benzin", "benzinli", "petrol", "gasoline"], ["elektrik", "elektrikli", "electric"],
  ["hibrit", "hybrid"], ["vw", "volkswagen"], ["mercedes", "mb"], ["chevrolet", "chevy"],
  ["filtre", "filter"], ["yag", "oil"], ["fren", "brake"], ["balata", "pad"], ["aku", "battery"],
  ["silecek", "wiper"], ["ampul", "bulb"], ["amortisor", "shock"], ["kayis", "belt"], ["rulman", "bearing"],
  ["pompa", "pump"], ["ayna", "mirror"], ["far", "headlight"], ["buji", "spark"], ["radyator", "radiator"],
  // Turkish market names of models TecDoc lists under their European name.
  ["egea", "tipo"], ["symbol", "thalia"], ["albea", "siena"],
];
const synonyms = new Map<string, string[]>();
for (const group of synonymGroups) for (const word of group) synonyms.set(word, group.filter(other => other !== word));

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

export function parseSearchQuery(raw: string, options: ParseOptions = {}): ParsedSearch {
  const normalized = normalizeSearchText(raw.slice(0, 120));
  const years: number[] = [];
  const terms: SearchTerm[] = [];
  const seen = new Set<string>();
  for (const word of normalized.split(" ").filter(Boolean)) {
    if (seen.has(word)) continue;
    seen.add(word);
    const year = Number(word);
    if (options.years && /^\d{4}$/.test(word) && year >= 1950 && year <= new Date().getFullYear() + 1) { years.push(year); continue; }
    const number = Number(word);
    const smallNumber = /^\d{1,2}$/.test(word) && number >= 1 && number <= 10;
    // "golf 7" means the seventh generation, not every "75 hp" variant: model numbers match whole.
    const alternatives: SearchAlternative[] = [{ value: word, prefix: !smallNumber }];
    for (const stem of stems(word)) alternatives.push({ value: stem, prefix: true });
    for (const synonym of synonyms.get(word) ?? []) alternatives.push({ value: synonym, prefix: true });
    // "320d", "c200": TecDoc writes engine and model codes apart ("320 d", "C 200").
    const split = word.match(/^(\d+)([a-z]+)$|^([a-z]+)(\d+)$/);
    if (split) alternatives.push({ value: split.slice(1).filter(Boolean).join(" "), prefix: true });
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
const lexeme = (value: string, prefix = false) => value.split(" ").map(part => `'${part}'`).join(" <-> ") + (prefix ? ":*" : "");

/** All required words, each as an OR of its spellings: `'tesla':* & ('y':*)`. Null when nothing is required. */
export function prefixTsQuery(parsed: ParsedSearch) {
  const required = parsed.terms.filter(term => term.required);
  if (!required.length) return null;
  return required.map(term => `(${term.alternatives.map(a => lexeme(a.value, a.prefix)).join(" | ")})`).join(" & ");
}

/** Any spelling of any query word as a whole word, for ranking exact hits above prefix hits. */
export function exactTsQuery(parsed: ParsedSearch) {
  if (!parsed.terms.length) return null;
  return [...new Set(parsed.terms.flatMap(term => term.alternatives.map(a => a.value)))].map(value => lexeme(value)).join(" | ");
}

