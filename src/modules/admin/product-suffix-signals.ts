// Pure helpers for the second-signal measurement on ambiguous part-number suffix pairs (#587). No database access:
// scripts/measure-suffix-signals.ts reads the labelled pairs and feeds them through these functions.
// The #899 review hints on the suffix candidates page (price ratio, pack words) come from here too.

export type SuffixStatus = "same" | "different";
export type SuffixVerdict = "same" | "different" | "review";

export type SuffixPair = {
  status: SuffixStatus;
  verdict: SuffixVerdict;
  brand: string;
  // Shorter and longer part number, and the extension the longer one adds to the shorter.
  numbers: [string, string];
  ext: string;
  // When the decision was made (ISO date), null for pairs that have no decision yet.
  decidedAt: string | null;
};

export type SignalMetrics = {
  fires: number;
  correct: number;
  wrong: number;
  precision: number;
  recall: number;
  coverage: number;
  wilson: number;
};

export type SignalPrediction = "same" | "different";
export type SignalDecision = "adopt-different" | "adopt-same" | "reject";

// Lower bound of the Wilson score interval (95% by default) for `successes` out of `n`.
export function wilsonLower(successes: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = successes / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

// A signal "fires" on a pair and predicts one label; it is correct when the human label agrees.
export function evaluateSignal<T extends { status: SuffixStatus }>(pairs: readonly T[], fires: (pair: T) => boolean, predicts: SignalPrediction): SignalMetrics {
  let fired = 0;
  let correct = 0;
  let predictedTotal = 0;
  for (const pair of pairs) {
    if (pair.status === predicts) predictedTotal++;
    if (!fires(pair)) continue;
    fired++;
    if (pair.status === predicts) correct++;
  }
  return {
    fires: fired,
    correct,
    wrong: fired - correct,
    precision: fired ? correct / fired : 0,
    recall: predictedTotal ? correct / predictedTotal : 0,
    coverage: pairs.length ? fired / pairs.length : 0,
    wilson: wilsonLower(correct, fired),
  };
}

export type SignalValidation = {
  // Pairs the rule already decides the other way (rule `same` for a "different" signal, rule `different` for a "same" one) on which the signal fires.
  contradictions: number;
  // Wrong calls among the trusted labels (every "different" plus "same" decided on or after the clean-up date).
  trustedWrong: number;
};

// The decision rule written into docs/product-matching.md.
export function signalDecision(predicts: SignalPrediction, metrics: SignalMetrics, validation: SignalValidation): SignalDecision {
  if (predicts === "different") {
    const ok = metrics.correct >= 10 && metrics.wrong <= 1 && metrics.wilson >= 0.85 && validation.contradictions <= 2;
    return ok ? "adopt-different" : "reject";
  }
  const ok = metrics.correct >= 30 && metrics.wrong === 0 && metrics.wilson >= 0.9 && validation.contradictions <= 4 && validation.trustedWrong === 0;
  return ok ? "adopt-same" : "reject";
}

const fold = (text: string) => text.toUpperCase().replace(/İ/g, "I").replace(/Ç/g, "C").replace(/Ğ/g, "G").replace(/Ö/g, "O").replace(/Ş/g, "S").replace(/Ü/g, "U");

// Pack/quantity markers in a product name, plus the pack marker an extension itself carries (2BL, 2HB).
export function packTokens(name: string, ext: string): string[] {
  const found = new Set<string>();
  for (const match of fold(name).matchAll(/\b(IKILI|2 ?LI|CIFT|SETI|SET|KITI|KIT|TAKIMI|TAKIM|\d+ ?(?:AD|ADET|LI|LU))\b/g)) found.add(match[1].replace(/ /g, ""));
  const extMatch = /^\d(?:BL|HB)$/.exec(fold(ext));
  if (extMatch) found.add(extMatch[0]);
  return [...found].sort();
}

/** The shorter/longer part number pair: the extension the longer adds, and which side is longer ("b" when equal). */
export function suffixExtension(a: string, b: string): { ext: string; longer: "a" | "b" } {
  const aLonger = a.length > b.length;
  const [short, long] = aLonger ? [b, a] : [a, b];
  return { ext: long.slice(short.length), longer: aLonger ? "a" : "b" };
}

type NamedPart = { partNumber: string; name: string | null };

/** Pack words of each side (the extension's own marker goes to the longer side) and whether the two sides differ. */
export function packHint(a: NamedPart, b: NamedPart): { a: string[]; b: string[]; differs: boolean } {
  const { ext, longer } = suffixExtension(a.partNumber, b.partNumber);
  const tokensA = packTokens(a.name ?? "", longer === "a" ? ext : "");
  const tokensB = packTokens(b.name ?? "", longer === "b" ? ext : "");
  return { a: tokensA, b: tokensB, differs: tokensA.join(",") !== tokensB.join(",") };
}

/** Larger cost over the smaller; null when either side has no positive cost. */
export function priceRatio(costA: number | null, costB: number | null): number | null {
  if (costA === null || costB === null || !(costA > 0) || !(costB > 0)) return null;
  return Math.max(costA, costB) / Math.min(costA, costB);
}

/** Cost ratios above this are flagged (the S6 "different" signal of #587). */
export const PRICE_RATIO_WARNING = 2;

export type SuffixHints = { priceRatio: number | null; priceWarning: boolean; pack: { a: string[]; b: string[]; differs: boolean } };

/** Review hints for a suffix candidate. They only inform the reviewer; no decision or bulk rule reads them. */
export function suffixHints(a: NamedPart & { costTry: number | null }, b: NamedPart & { costTry: number | null }): SuffixHints {
  const ratio = priceRatio(a.costTry, b.costTry);
  return { priceRatio: ratio, priceWarning: ratio !== null && ratio > PRICE_RATIO_WARNING, pack: packHint(a, b) };
}

export type YearRange = [from: number, to: number | null];

const fullYear = (text: string): number => {
  const value = Number(text);
  if (text.length === 4) return value;
  return value <= 29 ? 2000 + value : 1900 + value;
};

// Year span in a Başbuğ `y` field (`13-`, `15-19`) or, with `allowDash: false`, a Dinamik name (`2017>2020`, `08>`, `05> 11`).
// The end is null when open. null when the text holds no span.
export function yearRange(text: string, allowDash = true): YearRange | null {
  const separator = allowDash ? "[>-]" : ">";
  const match = new RegExp(`(?<![A-Za-z0-9])(\\d{4}|\\d{2})\\s*${separator}\\s*(?:(\\d{4}|\\d{2})(?![A-Za-z0-9]))?`).exec(text);
  if (!match) return null;
  const from = fullYear(match[1]);
  const to = match[2] ? fullYear(match[2]) : null;
  if (from < 1950 || from > 2100 || (to !== null && (to < from || to > 2100))) return null;
  return [from, to];
}

export function yearsOverlap(a: YearRange, b: YearRange): boolean {
  const aEnd = a[1] ?? 2100;
  const bEnd = b[1] ?? 2100;
  return a[0] <= bEnd && b[0] <= aEnd;
}

// Model words (letters only, at least 3) of a vehicle text: `GOLF5-GOLF6-JETTA-PASSAT` gives GOLF, JETTA, PASSAT.
export function modelTokens(text: string): string[] {
  const tokens = new Set<string>();
  for (const part of fold(text).split(/[^A-Z0-9]+/)) {
    const letters = part.replace(/[0-9]+$/, "");
    if (/^[A-Z]{3,}$/.test(letters)) tokens.add(letters);
  }
  return [...tokens].sort();
}

export function tokenOverlap(a: readonly string[], b: readonly string[]): number {
  const set = new Set(a);
  return b.filter(token => set.has(token)).length;
}
