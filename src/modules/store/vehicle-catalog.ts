import type { VehicleOilSpec } from "./vehicle-oil";

/** Side-view picture of a vehicle type from REPXPERT, stored as WebP (vehicle_type_images). */
export type VehicleImage = { src: string; width: number; height: number };

/** Technical data of a vehicle type read from REPXPERT (vehicle_type_specs); absent fields are null or empty. */
export type VehicleSpecs = {
  bodyType: string | null; driveType: string | null; fuelMixture: string | null;
  /** Valves are per cylinder. */
  cylinders: number | null; valves: number | null; engineCodes: string[];
};

/** `label` is the make in reading form ("Volkswagen"), set by the server for the picker; `name` stays the catalog's. */
export type VehicleBrand = { id: string; name: string; label?: string };
export type VehicleModel = {
  id: string; brandId: string; name: string; dateFrom: string | null; dateTo: string | null;
  /** The series name in reading form ("Golf VII (5G1)"), set by the server for the picker; `name` stays the catalog's. */
  label?: string;
  /** Picture of the series' most recent type that has one. */
  image?: VehicleImage;
};
export type CatalogVehicle = {
  id: string; modelId: string; brandId: string; make: string; model: string; generation: string;
  /** `make` and `model` in reading form, for display only (vehicle-label.ts). */
  makeLabel: string; modelLabel: string;
  from: number; to: number; dateFrom: string; dateTo: string | null;
  fuel: string; engine: string; power: string; cc: number | null;
  /** The type's own picture, else its series' picture. */
  image?: VehicleImage;
  /** Recommended engine oil; only the single-vehicle lookup (getCatalogVehicle) carries it. */
  oil?: VehicleOilSpec;
  /** REPXPERT technical data; like oil, only the single-vehicle lookup carries it. */
  specs?: VehicleSpecs;
};
export type SavedVehicle = {
  make: string; model: string; year: number; vehicleId?: string;
  generation?: string; fuel?: string; engine?: string; power?: string;
};
/** A saved vehicle with the labels the server derived for display; `make` and `model` stay the stored values. */
export type ShownVehicle = SavedVehicle & { makeLabel: string; modelLabel: string };
export type VehicleCatalogResponse = {
  brands?: VehicleBrand[]; models?: VehicleModel[]; vehicles?: CatalogVehicle[]; total?: number;
  /** Set when nothing matched as typed and the results are for this corrected spelling. */
  correctedQuery?: string;
};

export function vehicleDetails(vehicle: CatalogVehicle, year: number): SavedVehicle {
  return { make: vehicle.make, model: vehicle.model, year, vehicleId: vehicle.id,
    generation: vehicle.generation, fuel: vehicle.fuel, engine: vehicle.engine, power: vehicle.power };
}

export function normalizeVehicleSearch(value: string) {
  return value.toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
}

export function matchesVehicleSearch(query: string, ...values: string[]) {
  const haystack = normalizeVehicleSearch(values.join(" "));
  return normalizeVehicleSearch(query).trim().split(/\s+/).every(term => haystack.includes(term));
}

export type VehicleModelFamily = { key: string; name: string; label: string; models: VehicleModel[]; dateFrom: string | null; dateTo: string | null };

// Words that start a generation or body variant rather than continue the family name:
// roman numerals ("GOLF VII"), letter generations ("A4 B8", "ANTARA A", "MK II"), body types
// ("SUV", mixed-case "Sportback" / "T-Model") and lowercase sub-models ("A6 e-tron").
function familyStop(word: string) {
  return /^(?:[IVX]+|MK[IVX]*|[A-Z]\d?|SUV|MPV|VAN|BUS)$/.test(word) || /[a-z]/.test(word);
}

function familyWords(name: string) {
  return (name.replace(/\([^)]*\)/g, " ").trim() || name).split(/\s+/);
}

/** The family a series belongs to; "GRAND" only qualifies the next word (GRAND SCÉNIC ≠ GRAND KANGOO). */
export function vehicleModelFamilyKey(name: string) {
  const words = familyWords(name);
  return normalizeVehicleSearch(words.slice(0, words[0].toUpperCase() === "GRAND" ? 2 : 1).join(" "));
}

/**
 * TecDoc only lists model series ("A1 (8X1, 8XK)", "A1 Sportback (GBA)"). The picker groups them
 * into families the way Trodo does (AUDI › A1 › A1 (8X1, 8XK)): series sharing a first word form a
 * family named by their common leading words, cut before the first generation/body word.
 */
export function vehicleModelFamilies(models: VehicleModel[]): VehicleModelFamily[] {
  const groups = new Map<string, { words: string[][]; models: VehicleModel[] }>();
  for (const model of models) {
    const words = familyWords(model.name);
    const key = vehicleModelFamilyKey(model.name);
    const group = groups.get(key) ?? { words: [], models: [] };
    group.words.push(words); group.models.push(model);
    groups.set(key, group);
  }
  return [...groups].map(([key, group]) => {
    const [first, ...rest] = group.words;
    let length = key.split(" ").length;
    while (length < first.length && !familyStop(first[length])
      && rest.every(words => words[length] && normalizeVehicleSearch(words[length]) === normalizeVehicleSearch(first[length]))) length++;
    const dateFrom = group.models.reduce<string | null>((min, m) => m.dateFrom && (!min || m.dateFrom < min) ? m.dateFrom : min, null);
    const dateTo = group.models.some(m => !m.dateTo) ? null : group.models.reduce<string | null>((max, m) => !max || m.dateTo! > max ? m.dateTo : max, null);
    // The label takes the same leading words of the first series' reading form (a word-for-word conversion).
    const labelWords = group.models[0].label ? familyWords(group.models[0].label) : first;
    const name = first.slice(0, length).join(" ").toUpperCase();
    return { key, name, label: labelWords.length === first.length ? labelWords.slice(0, length).join(" ") : name, models: group.models, dateFrom, dateTo };
  }).sort((a, b) => a.name.localeCompare(b.name, "tr", { numeric: true }));
}

export function vehicleProductionDates(dateFrom: string | null, dateTo: string | null) {
  const format = (date: string) => date.split("-").reverse().join(".");
  return `${dateFrom ? format(dateFrom) : "Başlangıç bilinmiyor"} – ${dateTo ? format(dateTo) : "devam ediyor"}`;
}

// URL slug for /yedek-parca/{slug}: "ALFA ROMEO" → "alfa-romeo", "CITROËN" → "citroen".
export function vehicleBrandSlug(name: string) {
  return normalizeVehicleSearch(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Storefront order for the popular make grids (home page, /arac-markalari).
export const turkeyPopularMakes=["FIAT","RENAULT","VOLKSWAGEN","TOYOTA","HYUNDAI","FORD","DACIA","OPEL","PEUGEOT","CITROËN"];
export const popularVehicleMakes=[...new Set([...turkeyPopularMakes,"VOLKSWAGEN","AUDI","TOYOTA","BMW","OPEL","VOLVO","SKODA","RENAULT","MERCEDES-BENZ","PEUGEOT","FORD","KIA","HYUNDAI","SUBARU","MAZDA","CITROËN","NISSAN","LEXUS","HONDA","SEAT","FIAT","SUZUKI","JEEP","LAND ROVER","MITSUBISHI","CHEVROLET","DACIA","CHRYSLER","ALFA ROMEO","JAGUAR","PORSCHE","TESLA","DODGE","BENTLEY","MINI","CUPRA"])];

const makeKey=(name:string)=>normalizeVehicleSearch(name);
// Brand picker split: the most common makes in Türkiye first (in that order), the rest in the order received.
export function splitPopularBrands<T extends {name:string}>(brands:T[]):{popular:T[];others:T[]}{
  const rank=new Map(turkeyPopularMakes.map((name,index)=>[makeKey(name),index]));
  const popular=brands.filter(brand=>rank.has(makeKey(brand.name))).sort((a,b)=>rank.get(makeKey(a.name))!-rank.get(makeKey(b.name))!);
  return {popular,others:brands.filter(brand=>!rank.has(makeKey(brand.name)))};
}
