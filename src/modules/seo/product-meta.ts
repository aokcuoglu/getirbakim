import { commonMake, foldText, modelKeyword, primaryVehicle, readableProductName, vehicleLabel } from "@/modules/store/product-name";

// The page part of a search title stays within 60 characters: the root template appends " | Getirbakim" to it, and
// results show roughly 60 characters before cutting, so the brand, name and part number come first.
const titleBudget = 60;
const descriptionBudget = 160;

const wordsOf = (text: string) => foldText(text).split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The part number without a leading brand ("BOSCH 0986…" next to the brand "BOSCH"). A brand of several words ("KALE
 * RADYATOR") is often written by its first word alone in the number ("KALE 12345"), so that prefix goes too; the
 * number is never emptied.
 */
function numberWithoutBrand(partNumber: string, brand: string): string {
  const number = foldText(partNumber);
  const folded = foldText(brand).trim();
  for (const prefix of [folded, folded.split(/\s+/)[0]]) {
    if (prefix && number.startsWith(`${prefix} `) && partNumber.slice(prefix.length).trim()) return partNumber.slice(prefix.length).trim();
  }
  return partNumber.trim();
}

/** Name words that fit `room` characters, cut at a word boundary and never left with an open parenthesis. */
function fitWords(name: string, room: number): string {
  const words = name.split(" ").filter(Boolean);
  while (words.length > 0 && words.join(" ").length > room) words.pop();
  while (words.length > 0 && words.join(" ").split("(").length > words.join(" ").split(")").length) {
    const open = words.findLastIndex(word => word.includes("("));
    words.length = open;
  }
  return words.join(" ").replace(/[\s,/-]+$/, "");
}

/** The vehicle the product is about, with its full and short label; null when no vehicle can be named. */
function mainVehicle(vehicles: string[], hint: string) {
  const model = primaryVehicle(vehicles, hint);
  return model === null ? null : { model, ...vehicleLabel(model) };
}

/** " – ‹Marka› uyumlu" for a part of several models of one make that its name does not single out; none for other lists. */
function makeSuffix(base: string, input: { brand: string; name: string; vehicles: string[] }, max: number): string {
  const make = commonMake(input.vehicles);
  if (!make) return base;
  const makeWords = wordsOf(make);
  if (makeWords.every(word => wordsOf(input.name).includes(word) || wordsOf(input.brand).includes(word))) return base;
  const candidate = `${base} – ${make} uyumlu`;
  return candidate.length <= max ? candidate : base;
}

/**
 * "‹Marka› ‹ad› ‹parça no›", then " – ‹araç› uyumlu" when it fits (the full vehicle name, else the short one, else none;
 * none too when the name already carries the model). Several models of one make that the name does not single out give
 * " – ‹Marka› uyumlu"; across two makes or more nothing is added. Only the name gives way to the limit: brand and part number are the
 * product's identity and are never cut.
 */
export function productSeoTitle(input: { brand: string; name: string; partNumber: string; vehicles: string[]; hint: string; max?: number }): string {
  const max = input.max ?? titleBudget;
  const number = numberWithoutBrand(input.partNumber, input.brand);
  const fixed = [input.brand, number].filter(Boolean);
  const room = max - fixed.join(" ").length - 1;
  const name = fitWords(input.name, room);
  const base = [input.brand, name, number].filter(Boolean).join(" ");
  if (name !== input.name.trim()) return base;
  const vehicle = mainVehicle(input.vehicles, input.hint);
  if (!vehicle) return makeSuffix(base, input, max);
  if (!vehicle.short) return base;
  const keyword = modelKeyword(vehicle.model);
  if (keyword && wordsOf(input.name).includes(keyword)) return base;
  // A model without a name word ("3", "124") says nothing short; only its full label ("BMW 3") may stand.
  for (const label of keyword === null ? [vehicle.full] : [vehicle.full, vehicle.short]) {
    const candidate = `${base} – ${label} uyumlu`;
    if (candidate.length <= max) return candidate;
  }
  return base;
}

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * Sentences added while they fit 160 characters: "‹Marka› ‹parça no› ‹ad›.", "OEM: ‹kod›.", "Uyumlu araçlar: A, B ve N model
 * daha.", then the product's own description. The part number keeps descriptions of different products apart; price and
 * stock are left out, they change faster than a search result is refreshed.
 */
export function productSeoDescription(input: { brand: string; name: string; partNumber: string; oem?: string; vehicles: string[]; text?: string; hint?: string; max?: number }): string {
  const max = input.max ?? descriptionBudget;
  const number = numberWithoutBrand(input.partNumber, input.brand);
  const lead = [input.brand, number].filter(Boolean).join(" ");
  let description = sentence(`${lead} ${fitWords(input.name, max - lead.length - 2)}`.trim());
  const append = (next: string) => {
    if (description.length + 1 + next.length > max) return false;
    description = `${description} ${next}`;
    return true;
  };
  const oem = input.oem?.trim();
  if (oem) append(`OEM: ${oem}.`);
  const main = mainVehicle(input.vehicles, input.hint ?? input.name);
  const labels = [...new Set(input.vehicles.map(vehicleLabel).filter(label => label.short).map(label => label.full))];
  if (main) labels.sort((a, b) => Number(b === main.full) - Number(a === main.full));
  for (let shown = Math.min(labels.length, 4); shown >= 1; shown--) {
    const rest = labels.length - shown;
    if (append(`Uyumlu araçlar: ${labels.slice(0, shown).join(", ")}${rest > 0 ? ` ve ${rest} model daha` : ""}.`)) break;
  }
  const text = input.text && /\p{L}/u.test(input.text) ? readableProductName(input.text) : "";
  if (text) {
    const room = max - description.length - 1;
    if (sentence(text).length <= room) append(sentence(text));
    else if (room >= 30) {
      const cut = fitWords(text, room - 1);
      if (cut) append(`${cut}…`);
    }
  }
  return description;
}
