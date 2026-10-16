// Shared, side-effect free rules for model series photographs: how a TecDoc model name becomes Wikidata search
// queries, which Commons licences may be shown on the store, and how an image is attributed.

export type VehicleModelImage = {
  src: string; width: number; height: number;
  /** "Foto: <author> · <licence>" — shown with the image, as CC BY / CC BY-SA require. */
  attribution: string; sourceUrl: string;
};

export type ImageMatchKind = "generation" | "family";

// TecDoc brand spellings Wikidata labels do not use.
const wikidataBrands: Record<string, string> = {
  VW: "Volkswagen", "MERCEDES-BENZ": "Mercedes-Benz", "FORD USA": "Ford", SKODA: "Škoda", TOFAS: "Tofaş", "CITROËN": "Citroën",
  BMW: "BMW", MG: "MG", DS: "DS", KTM: "KTM", TVR: "TVR", SEAT: "SEAT", GMC: "GMC", BYD: "BYD", MINI: "Mini", "ALFA ROMEO": "Alfa Romeo",
  "LAND ROVER": "Land Rover", "ASTON MARTIN": "Aston Martin", SSANGYONG: "SsangYong", "KG MOBILITY": "KG Mobility", MCLAREN: "McLaren",
  DAF: "DAF", MAN: "MAN", "ROLLS-ROYCE": "Rolls-Royce", AC: "AC", UAZ: "UAZ", GAZ: "GAZ", ZAZ: "ZAZ", VAZ: "VAZ", FAW: "FAW", JAC: "JAC",
  BAIC: "BAIC", GWM: "GWM", JMC: "JMC", DFSK: "DFSK", "CHEVROLET USA": "Chevrolet", "DODGE USA": "Dodge", "TOYOTA USA": "Toyota", "NISSAN USA": "Nissan",
  "HONDA USA": "Honda", "MAZDA USA": "Mazda", "HYUNDAI USA": "Hyundai", "KIA USA": "Kia", "MITSUBISHI USA": "Mitsubishi", "SUBARU USA": "Subaru",
};
const titleCase = (value: string) => value.toLocaleLowerCase("en").replace(/(^|[\s-])(\p{L})/gu, (_, boundary, letter) => boundary + letter.toLocaleUpperCase("en"));
export function wikidataBrandName(brand: string) {
  const key = brand.trim().toLocaleUpperCase("en");
  return wikidataBrands[key] ?? titleCase(brand.trim());
}

// Body style and market words TecDoc appends to a series; Wikidata items are named after the series alone.
const bodyWords = /\b(Hatchback|Van|Grandtour|Sport Tourer|Sports Tourer|Estate|Saloon|Sedan|Convertible|Cabriolet|Cabrio|Coupe|Coupé|Kombi|Variant|Box|Bus|Platform\/Chassis|Platform|Chassis|Kasten|Pritsche\/Fahrgestell|Turnier|Combi|Break|Tourer|Touring|SW|Station Wagon|Wagon|Liftback|Sportback|Avant|Allroad|Cargo|Minibus|Pickup|Pick-up|Roadster|Spider|Targa|MPV|Limousine|Notchback|Fastback|Caravan|Hardtop|Softtop|Furgon|Maxi|Compact|Crossover|Grand Coupe|Gran Coupe|Gran Turismo|Shooting Brake|Sportbrake|Active Tourer|Gran Tourer|Sportsvan|Sportswagon|Sportstourer|SUV|GTC|Dualis|Phase I|Phase II|Facelift|LCV|Truck|Lorry|Dumptruck|Tipper|Tractor|Tractor Unit|Double Cab|Single Cab|Crew Cab|Extended Cab|Chassis Cab|Panel Van|Bus\/Coach|Coach|Flatbed)\b/giu;
const romans: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
const romanWord = /^(I{1,3}|IV|VI{0,3}|IX|XI{0,2})$/;
// Factory/chassis codes in TecDoc names: "B7_", "5G1", "W205", "F30", "E210", "_E21_", "QL", "KH_".
const codeWord = /^[A-Z]{0,2}\d{1,3}[A-Z]{0,2}$|^[A-Z]{1,2}\d{2,3}$/;

export type ModelImageQueries = {
  /** Ordered Wikidata searches: the most specific (generation) first, the plain model family last. */
  queries: string[];
  /** Series name without body words, brand prefixed ("Renault Clio V"). */
  series: string;
  /** Model family name ("Clio"). */
  family: string;
  /** The TecDoc name names a generation (roman numeral, chassis code or letter generation such as "Astra K"). */
  generationMarker: boolean;
};

/** Search queries for a TecDoc model series such as "CLIO V (B7_)" of brand "RENAULT". */
export function vehicleModelImageQueries(brand: string, model: string): ModelImageQueries {
  const maker = wikidataBrandName(brand);
  // "(B7_)", "(5G1, BQ1)", "(_E21_)", "(KE, GH)": chassis codes, underscores being TecDoc wildcards.
  const codes = [...new Set([...model.matchAll(/\(([^)]*)\)/g)].flatMap(match => match[1].split(/[,/ ]+/))
    .map(code => code.replace(/[_ ]/g, "").toLocaleUpperCase("en")).filter(code => /^[A-Z0-9]{2,6}$/.test(code) && code !== model.toLocaleUpperCase("en")))];
  const numberedCodes = codes.filter(code => /\d/.test(code));
  const stripped = model.replace(/\([^)]*\)/g, " ").replace(bodyWords, " ").replace(/\s+/g, " ").trim();
  const words = stripped.split(" ").filter(Boolean);
  // Trailing generation words: "CLIO V", "ASTRA K", "GOLF VII", "3 (F30)" keeps "3" as the family.
  let family = words, generation: string | null = null;
  const last = words.at(-1) ?? "";
  if (words.length > 1 && romanWord.test(last)) { family = words.slice(0, -1); generation = last; }
  else if (words.length > 1 && /^[A-Z]$/.test(last) && /^[A-Za-z]/.test(words[0])) { family = words.slice(0, -1); generation = last; }
  const familyName = titleCase(family.join(" ")) || titleCase(stripped);
  const queries: string[] = [];
  const add = (query: string) => { const text = query.replace(/\s+/g, " ").trim(); if (text && !queries.includes(text)) queries.push(text); };
  if (generation) {
    add(`${maker} ${familyName} ${generation}`);
    const number = romans[generation];
    if (number) { add(`${maker} ${familyName} Mk${number}`); add(`${maker} ${familyName} ${number}`); }
  }
  for (const code of codes.slice(0, 3)) { add(`${maker} ${familyName} ${code}`); if (/\d/.test(code)) add(`${maker} ${code}`); }
  add(`${maker} ${titleCase(stripped)}`);
  add(`${maker} ${familyName}`);
  const hasCode = numberedCodes.some(code => codeWord.test(code)) || codes.some(code => /^[A-Z]{2,3}$/.test(code));
  return { queries, series: `${maker} ${titleCase(stripped)}`.trim(), family: familyName, generationMarker: Boolean(generation) || hasCode };
}

/** Licences the store may show with attribution; anything else (NC, ND, unknown) stays out. */
export function acceptedLicense(shortName: string | null | undefined) {
  const name = (shortName ?? "").trim();
  return /^(CC0(\s*1\.0)?|CC[- ]BY(-SA)?(\s*\d(\.\d)?)?(\s*[A-Za-z]{2})?|Public domain|PD(-[A-Za-z-]+)?)$/i.test(name);
}

// Labels that name one generation: "Golf Mk7", "Clio V", "Astra K", "Corolla (E210)", "W205", "Kuga (second generation)", "Tipo (2015)".
const generationLabel = /(\bMk\s?\d+\b|\s[IVX]{1,4}(\s|$)|\s[A-Z]$|\b[A-Z]{1,2}\d{2,3}\b|\(\d{4}\))/;
/** How confidently the matched item names the TecDoc series; a family hit on a multi-generation model needs review. */
export function classifyMatch(item: { label: string; description?: string | null; partOfSeries: boolean }, context: { family: string; generationMarker: boolean }): ImageMatchKind {
  if (!context.generationMarker || item.partOfSeries) return "generation";
  // The family name itself may look like a code ("S60", "C4"); only what the label adds to it counts.
  const rest = item.label.split(new RegExp(`\\b${context.family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")).join(" ").replace(/\s+/g, " ").trim();
  if (generationLabel.test(rest) || /\bgeneration\b/i.test(`${item.label} ${item.description ?? ""}`)) return "generation";
  return "family";
}

const htmlTags = /<[^>]*>/g;
/** Plain-text author from Commons' HTML "Artist" field. */
export function plainAuthor(artist: string | null | undefined) {
  const text = (artist ?? "").replace(htmlTags, "").replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}…` : text || null;
}

export function vehicleModelImageAttribution(image: { author: string | null; license: string }) {
  return `Foto: ${image.author || "Wikimedia Commons"} · ${image.license}`;
}
