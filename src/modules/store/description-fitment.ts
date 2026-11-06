// Model-level fitment read from a supplier's product description (#392), for products no TecDoc source covers.
// Dinamik names the vehicle in free text: "STOP LAMBASI ARKA SOL SCIROCCO 2008>2015", "FAR KASASI F32 LCI F36 LCI 16>20",
// with the vehicle make in `kull1s` ("VAG", "PSA", "MERCEDES"…). The text never names an engine, so a match is a
// catalog model (one generation, every body style) and the year range the description gives, nothing finer.

export type DescriptionCatalogModel = { id: number; brand: string; name: string; from: number | null; to: number | null };
export type DescriptionFitment = { status: "matched" | "no_brand" | "no_model" | "years_conflict" | "ambiguous"; how: "code" | "family" | null;
  modelIds: number[]; models: { id: number; yearFrom: number | null; yearTo: number | null }[] };

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
// Words after the model family that name a body style or generation, not another model.
const BODY = new Set(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "VAN", "CONVERTIBLE", "COUPE", "CABRIO", "CABRIOLET", "ESTATE", "HATCHBACK",
  "SALOON", "SEDAN", "SPORTBACK", "VARIANT", "AVANT", "TOURER", "BUS", "PLATFORM/CHASSIS", "PICKUP", "MPV", "KOMBI", "BOX", "BODY/ESTATE",
  "T-MODEL", "SHOOTING", "BRAKE", "LIMOUSINE", "ROADSTER", "SPORTS", "ALL-TERRAIN", "GRAN", "COMBI", "FLATBED/CHASSIS", "CLOSED", "OFF-ROAD",
  "VEHICLE", "TOURING", "SPORTWAGON", "SW", "BREAK", "CROSSOVER", "TRUCK"]);
// Model families that are ordinary words in a part description.
const GENERIC = new Set(["SPORT", "CLASSIC", "CITY", "STAR", "LINE", "CARGO", "COMBO", "ONE", "PLUS", "MAX", "PRO", "NEW", "GT", "GTI", "RS", "LX",
  "SE", "EV", "E", "S", "X", "ID", "UP", "KA", "UNO"]);
// Dinamik's `kull1s` groups; any other value is the catalog make itself.
const MAKES: Record<string, string[]> = { VAG: ["VW", "AUDI", "SEAT", "SKODA", "PORSCHE", "CUPRA"], PSA: ["PEUGEOT", "CITROEN", "DS"],
  MERCEDES: ["MERCEDES-BENZ"], TOFAS: ["FIAT"], "RENAULT ESKI": ["RENAULT"], "MITSUBISHI TICARI": ["MITSUBISHI"], "ISUZU TICARI": ["ISUZU"],
  "IVECO TICARI": ["IVECO"], CHEVROLET: ["CHEVROLET", "DAEWOO"], FORD: ["FORD", "FORD OTOSAN"] };
const CODE = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{3,}$/;

export const normalizeText = (value: string) => value.replace(/İ/g, "I").replace(/ı/g, "i").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const tokens = (value: string) => normalizeText(value).replace(/\b([A-Z]{1,3})\s+KLAS\b/g, "$1 CLASS").replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);

type Model = { id: number; brand: string; family: string; generation: number | null; codes: Set<string>; from: number | null; to: number | null };

function describe(model: DescriptionCatalogModel): Model & { wordCodes: string[] } {
  const words = normalizeText(model.name.split("(")[0]).trim().split(/\s+/);
  const family: string[] = [];
  for (const [i, word] of words.entries()) {
    if (BODY.has(word) || /^\d+(,\d+)?-T$/.test(word) || (i && /\d/.test(word))) break;
    family.push(word);
  }
  const rest = words.slice(family.length);
  const codes = new Set<string>();
  for (const [, inner] of model.name.matchAll(/\(([^)]*)\)/g)) for (const code of normalizeText(inner).split(/[,\s/]+/)) if (CODE.test(code)) codes.add(code);
  return { id: model.id, brand: normalizeText(model.brand), family: family.join(" ").replace(/-/g, " "), codes, from: model.from, to: model.to,
    generation: rest.map(word => ROMAN[word]).find(Boolean) ?? (/^[1-9]$/.test(rest[0] ?? "") ? Number(rest[0]) : null), wordCodes: rest.filter(word => /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{2,}$/.test(word)) };
}

/** First year range in the text: "2008>2015", "16>20", "09>", "(91>95)", "13-22". Two-digit years from 30 are 19xx. */
export function descriptionYears(text: string): [number, number | null] | null {
  const match = /(?<![\d.,])((?:19|20)?\d{2})\s*(?:>|-)\s*((?:19|20)?\d{2})?(?![\d.,])/.exec(normalizeText(text));
  if (!match) return null;
  const full = (value: string | undefined) => { if (!value) return null; const year = Number(value); return year >= 1900 ? year : year >= 30 ? 1900 + year : 2000 + year; };
  const from = full(match[1])!, to = full(match[2]);
  if (from < 1950 || from > 2030 || (to !== null && to < from)) return null;
  return [from, to];
}

export function createDescriptionMatcher(catalog: DescriptionCatalogModel[], currentYear = new Date().getFullYear()) {
  const byBrand = new Map<string, Model[]>();
  for (const model of catalog.map(describe)) {
    const list = byBrand.get(model.brand) ?? [];
    list.push(model);
    byBrand.set(model.brand, list);
  }
  for (const models of byBrand.values()) {
    const families = new Set(models.map(model => model.family));
    for (const model of models as (Model & { wordCodes?: string[] })[]) {
      // "A4 B9" carries the B9 code; "GRAND C4 SPACETOURER" must not claim the C4 family's token.
      for (const code of model.wordCodes ?? []) if (!families.has(code)) model.codes.add(code);
      delete model.wordCodes;
      // An open-ended generation ends where the family's next generation starts.
      if (model.to === null && model.from !== null) {
        const later = models.filter(other => other.family === model.family && other.from !== null && other.from >= model.from! + 4).map(other => other.from!);
        if (later.length) model.to = Math.min(...later);
      }
    }
  }
  const brands = [...byBrand.keys()];

  return function match(make: string, description: string): DescriptionFitment {
    const none = (status: DescriptionFitment["status"]): DescriptionFitment => ({ status, how: null, modelIds: [], models: [] });
    const makeKey = normalizeText(make).trim();
    // Trucks, trailers and universal parts are outside the passenger-car and light-commercial catalog.
    if (/TRUCK|DORSE|UNIVERSAL/.test(makeKey)) return none("no_brand");
    const text = normalizeText(description), words = tokens(description), set = new Set(words), padded = ` ${words.join(" ")} `;
    const makes = new Set((MAKES[makeKey] ?? [makeKey]).filter(brand => byBrand.has(brand)));
    for (const brand of brands) if (brand.length > 3 && padded.includes(` ${brand} `)) makes.add(brand);
    if (!makes.size) return none("no_brand");
    const candidates = [...makes].flatMap(brand => byBrand.get(brand)!);
    const named = (model: Model) => padded.includes(` ${model.brand.split(/[^A-Z0-9]/)[0]} `);
    const codeHits = candidates.filter(model => [...model.codes].some(code => set.has(code)));
    const coded = new Set(codeHits.map(model => `${model.brand}|${model.family}`));
    let familyHits = candidates.filter(model => {
      const family = model.family;
      if (!family || coded.has(`${model.brand}|${family}`) || GENERIC.has(family) || (family.length < 3 && !/\d/.test(family))) return false;
      // A number ("206", "440", "3") is a model only beside its make ("MAZDA 3", "PEUGEOT 206") or as "P206", and
      // never inside a measurement ("105,2").
      if (/^\d+$/.test(family)) return (named(model) || (model.brand === "PEUGEOT" && (makeKey === "PSA" || set.has(`P${family}`))))
        && new RegExp(`(?<![A-Z0-9.,])P?${family}(?![A-Z0-9]|[.,]\\d)`).test(text);
      return padded.includes(` ${family} `);
    });
    // A family spelled inside a longer one ("SCENIC" in "GRAND SCENIC") is that longer one.
    const families = new Set(familyHits.map(model => model.family));
    familyHits = familyHits.filter(model => ![...families].some(other => other !== model.family && ` ${other} `.includes(` ${model.family} `)));
    const groups = new Map<string, { models: Model[]; anchor: string; precise: boolean }>();
    for (const model of codeHits) {
      const key = `${model.brand}|${model.family}|code`, group = groups.get(key) ?? { models: [], anchor: [...model.codes].find(code => set.has(code))!, precise: true };
      group.models.push(model); groups.set(key, group);
    }
    for (const family of new Set(familyHits.map(model => `${model.brand}|${model.family}`))) {
      let models = familyHits.filter(model => `${model.brand}|${model.family}` === family);
      const familyWords = models[0].family.split(" ");
      // "CLIO IV", "MEGANE 4", "MEGANE I II", "GOLF IV / V": the generations written right after the family.
      const generations = new Set<number>();
      for (let i = 0; i + familyWords.length < words.length; i++) {
        if (!familyWords.every((word, j) => words[i + j] === word)) continue;
        for (let k = i + familyWords.length; k < words.length; k++) {
          // An arabic digit counts only right after the family and not as an engine size ("MONDEO IV 1.6").
          const arabic = k === i + familyWords.length && /^[1-9]$/.test(words[k])
            && new RegExp(`(?<![A-Z0-9])${familyWords.join("[^A-Z0-9]+")}[^A-Z0-9]+${words[k]}(?![0-9]|[.,][0-9])`).test(text);
          const generation = ROMAN[words[k]] ?? (arabic ? Number(words[k]) : null);
          if (!generation) break;
          generations.add(generation);
        }
      }
      const precise = generations.size > 0 && models.some(model => model.generation !== null && generations.has(model.generation));
      if (precise) models = models.filter(model => model.generation !== null && generations.has(model.generation));
      groups.set(family, { models, anchor: models[0].family, precise });
    }
    if (!groups.size) return none("no_model");
    const kept: DescriptionFitment["models"] = [];
    let conflict = false;
    for (const { models, anchor, precise } of groups.values()) {
      // The years that follow the family or code in the text ("CORDOBA IBIZA FABIA 00>15 POLO 02>"), else the first.
      const at = new RegExp(`(?<![A-Z0-9])${anchor.split(" ").join("[^A-Z0-9]+")}(?![A-Z0-9])`).exec(text)?.index ?? 0;
      const years = descriptionYears(text.slice(at)) ?? descriptionYears(text);
      if (!years) {
        // Without years or a generation a family name spans every generation ("ESCORT", "DAILY"); it is kept only when
        // its models all overlap in time, one generation in several body styles.
        const single = Math.max(...models.map(model => model.from ?? 1900)) <= Math.min(...models.map(model => model.to ?? currentYear));
        if (precise || single) kept.push(...models.map(model => ({ id: model.id, yearFrom: null, yearTo: null })));
        continue;
      }
      // Keep the generation(s) covering most of the part's years; for an open range ("09>") that is its first few
      // years, the generation the part was made for.
      const [from, to] = years;
      let end = Math.min(to ?? from + 3, currentYear);
      if (end <= from) end = from + 1;
      const score = new Map(models.map(model => [model, Math.min(model.to ?? currentYear, end) - Math.max(model.from ?? 1900, from)]));
      const best = Math.max(...score.values());
      if (best < 0 || (best === 0 && end - from > 1)) { conflict = true; continue; }
      kept.push(...models.filter(model => score.get(model) === best).map(model => ({ id: model.id, yearFrom: from, yearTo: to })));
    }
    const unique = [...new Map(kept.map(model => [model.id, model])).values()].sort((a, b) => a.id - b.id);
    if (!unique.length) return none(conflict ? "years_conflict" : "ambiguous");
    return { status: "matched", how: codeHits.length ? "code" : "family", modelIds: unique.map(model => model.id), models: unique };
  };
}
