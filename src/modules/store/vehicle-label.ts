// Readable vehicle names for every visitor-facing garage, vehicle picker and fitment label (#689). TecDoc writes makes
// and series in capitals ("VOLKSWAGEN", "GOLF VII (5G1, BQ1, BE1, BE2)"); the store prints "Volkswagen" and
// "Golf VII (5G1, BQ1, BE1, BE2)", the spelling of the listing pages (#685). Labels are derived at render time: the stored
// make and model (garage rows, cookies, keys, `fits` filtering, fitment matching) stay the catalog's own values.
//
// Server side only: this module reaches the Turkish word dictionary of product-name.ts, which must stay out of client
// bundles. Client components receive the labels as fields (`makeLabel`, `modelLabel`, `label`) and never import it
// (scripts/test-vehicle-label.ts reads their imports).
import { readableProductName } from "./product-name";

// Makes the product-name rule cannot spell: the brands write them with a capital inside or a leading lower case letter.
const makeSpellings: Record<string, string> = { MCLAREN: "McLaren", SSANGYONG: "SsangYong", "E.GO": "e.GO", "LYNK & CO": "Lynk & Co",
  GAZ: "GAZ", UAZ: "UAZ", ZAZ: "ZAZ", AMC: "AMC", BAC: "BAC", EMC: "EMC", UMM: "UMM", XEV: "XEV" };

/** A make in reading form: "VOLKSWAGEN" → "Volkswagen", "MERCEDES-BENZ" → "Mercedes-Benz", "BMW" stays (the rule of product names). */
export const vehicleMakeLabel = (name: string) => makeSpellings[name.trim().toUpperCase()] ?? readableProductName(name);

// Series words that are codes or spelled in lower case, read from all local vehicle_models (2026-11-15): kept as the
// catalog writes them, where the product-name rule would read them as words ("EB" → "Eb", "E-TRON" → "E-Tron").
const seriesSpellings: Record<string, string> = { "E-TRON": "e-tron", ...Object.fromEntries(("EQT MKII IIA GTO MGA AR EB ASLK TSO LNA ANC AKZ RLE NPE EXC FUV ADV AH AP AY UC UE UF UH FES NES SES")
  .split(" ").map(code => [code, code])), ...Object.fromEntries(Object.entries(makeSpellings).filter(([key]) => !key.includes(" ")).map(([key, value]) => [key, value])) };

/**
 * A model series or a "<make> <model>" text in reading form. Words are converted one by one with the product-name rule
 * (codes, roman numerals and abbreviations stay), and the chassis codes in brackets stay as written:
 * "GOLF VII (5G1, BQ1)" → "Golf VII (5G1, BQ1)"; a word with a lower case letter ("Variant", "T-Model") is kept.
 */
export function vehicleSeriesLabel(name: string): string {
  return name.trim().split(/(\([^)]*\)?)/).map((part, index) => index % 2 ? part
    : part.split(" ").map(word => word && (seriesSpellings[word] ?? readableProductName(word))).join(" ")).join("");
}

export type VehicleLabels = { makeLabel: string; modelLabel: string };

/** A vehicle of the garage or the catalog with its labels; the make and model themselves are untouched. */
export function shownVehicle<T extends { make: string; model: string }>(vehicle: T): T & VehicleLabels;
export function shownVehicle<T extends { make: string; model: string }>(vehicle: T | null): (T & VehicleLabels) | null;
export function shownVehicle<T extends { make: string; model: string }>(vehicle: T | null) {
  return vehicle && { ...vehicle, makeLabel: vehicleMakeLabel(vehicle.make), modelLabel: vehicleSeriesLabel(vehicle.model) };
}

/** "Volkswagen Golf VII (5G1) 1.0 TSI": the label a text names a vehicle by (the engine is written as stored). */
export function vehicleText(vehicle: VehicleLabels & { engine?: string }) {
  return [vehicle.makeLabel, vehicle.modelLabel, vehicle.engine].filter(Boolean).join(" ");
}

// Spellings a source writes for a catalog make.
const makeAliases: Record<string, string> = { VW: "VOLKSWAGEN", MERCEDES: "MERCEDES-BENZ" };

/**
 * The make of a fitment row and its readable labels. A linked row names its catalog brand; an unlinked one keeps the source's
 * spelling ("VW GOLF VII", "ALFA ROMEO MITO"), so its make is the longest leading words that name a catalog make (after the
 * aliases), else its first word. `makeKey` is the make as the catalog writes it (the filter's value), `modelLabel` reads the
 * same for every spelling of one model ("VW GOLF VII (5G1)" and "VOLKSWAGEN GOLF VII (5G1)" → "Volkswagen Golf VII (5G1)").
 * The row's own `model` stays as stored.
 */
export function fitmentLabels(vehicle: { model: string | null; catalogBrand?: string | null }, makes: readonly string[]) {
  const model = (vehicle.model ?? "").trim().replace(/\s+/g, " "), words = model.split(" ").filter(Boolean);
  const known = new Map(makes.map(make => [make.toUpperCase(), make]));
  let makeKey = vehicle.catalogBrand || "", length = makeKey ? makeKey.split(" ").length : 0;
  if (!makeKey) {
    for (let count = Math.min(3, words.length); count > 0 && !makeKey; count--) {
      const lead = words.slice(0, count).join(" ").toUpperCase(), name = known.get(makeAliases[lead] ?? lead);
      if (name) { makeKey = name; length = count; }
    }
    if (!makeKey) { makeKey = words[0] ?? ""; length = words[0] ? 1 : 0; }
  }
  // A catalog brand the model text does not start with names no leading words of it.
  const rest = vehicle.catalogBrand && !model.toUpperCase().startsWith(`${makeKey.toUpperCase()} `) ? model : words.slice(length).join(" ");
  return { makeKey, makeLabel: vehicleMakeLabel(makeKey), modelLabel: `${vehicleMakeLabel(makeKey)} ${vehicleSeriesLabel(rest)}`.trim() };
}
