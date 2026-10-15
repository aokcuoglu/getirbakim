import type { EnrichmentData } from "./enrichment-contract";

export const FITMENT_MATCHER_VERSION = "strict-v3";
export type SourceVehicle = EnrichmentData["vehicles"][number];
export type FitmentCatalogModel = { id: number; brand_id: number; brand: string; display_brand: string; name: string };
export type FitmentCatalogType = { id: number; model_id: number; name: string; cc: number | null; fuel_type: string; hp: number; kwt: number; date_from: string; date_to: string | null };
export type FitmentMatch = { sourceIndex: number; source: SourceVehicle; typeId: number | null; status: "matched" | "model_missing" | "attributes_missing" | "dates_differ" | "engine_name_differs" | "ambiguous"; candidateTypeIds: number[] };
const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const month = (value: string | null) => value ? `${value.slice(3)}-${value.slice(0, 2)}` : null;
// Turkish storefronts (otoparcasan.com) translate TecDoc's English series and body names. Tried only when the
// model name as given is unknown, since some catalog names keep a Turkish word ("MEGANE I Kombi van (KA_)").
const turkishNames: [RegExp, string][] = [
  [/\b([A-Z]{1,3})-SERISI\b/g, "$1-CLASS"], [/\bMINIBUS\/OTOBUS\b/g, "BUS"], [/\bPANELVAN\/VAN\b/g, "VAN"],
  [/\bKASA\/BUYUK LIMUZIN\b/g, "BOX BODY/MPV"], [/\bPLATFORM SASI\b/g, "PLATFORM/CHASSIS"], [/\bSTATION WAGON\b/g, "ESTATE"],
  [/\bKOMBI VAN\b/g, "ESTATE VAN"], [/\bCABRIO\b/g, "CONVERTIBLE"], [/\bSEDAN\b/g, "SALOON"], [/\bPICK-UP\b/g, "PICKUP"],
];
export const englishModelName = (value: string) => turkishNames.reduce((name, [pattern, english]) => name.replace(pattern, english), normalize(value));

export function createFitmentMatcher(models: FitmentCatalogModel[], types: FitmentCatalogType[]) {
  const modelsByName = new Map<string, number[]>();
  const typesByModel = new Map<number, FitmentCatalogType[]>();
  for (const model of models) {
    for (const name of new Set([normalize(`${model.brand} ${model.name}`), normalize(`${model.display_brand} ${model.name}`)])) {
      modelsByName.set(name, [...(modelsByName.get(name) || []), model.id]);
    }
  }
  for (const type of types) typesByModel.set(type.model_id, [...(typesByModel.get(type.model_id) || []), type]);
  return (source: SourceVehicle, sourceIndex: number): FitmentMatch => {
    const modelIds = modelsByName.get(normalize(source.model)) || modelsByName.get(englishModelName(source.model)) || [];
    const candidates = modelIds.flatMap(id => typesByModel.get(id) || []);
    const attributes = candidates.filter(type => (type.cc === source.cc || (type.cc === null && source.cc === 0 && source.fuel === "Electric")) && type.hp === source.ps && type.kwt === source.kw && type.fuel_type === source.fuel);
    const exactDates = attributes.filter(type => type.date_from === month(source.from) && type.date_to === month(source.to));
    // A source that leaves the end open (still listed as in production) may meet a catalog type that has since closed;
    // the start date and every attribute must still agree, and the engine-name and uniqueness rules below still apply.
    const dates = exactDates.length || source.to !== null ? exactDates
      : attributes.filter(type => type.date_from === month(source.from) && type.date_to !== null);
    const sourceEngine = normalize(source.engineAndCodes);
    const engines = dates.filter(type => sourceEngine === normalize(type.name) || sourceEngine.startsWith(`${normalize(type.name)} `));
    const longest = Math.max(0, ...engines.map(type => normalize(type.name).length));
    const selected = engines.filter(type => normalize(type.name).length === longest);
    let status: FitmentMatch["status"];
    if (!modelIds.length) status = "model_missing";
    else if (!attributes.length) status = "attributes_missing";
    else if (!dates.length) status = "dates_differ";
    else if (!selected.length) status = "engine_name_differs";
    else if (selected.length > 1) status = "ambiguous";
    // A base engine prefix must not consume an unmatched drivetrain variant.
    else if (/^(4MOTION|4X4|XDRIVE|QUATTRO|ACTIVE|ALL-WHEEL DRIVE)(?: |$)/.test(sourceEngine.slice(normalize(selected[0].name).length).trim())) status = "engine_name_differs";
    else status = "matched";
    return { sourceIndex, source, status, typeId: status === "matched" ? selected[0].id : null,
      candidateTypeIds: (dates.length ? dates : attributes).map(type => type.id) };
  };
}
