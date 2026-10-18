/** Recommended engine oil of a vehicle type (db/vehicle-oil-specs.sql). */
export type VehicleOilSpec = {
  viscosities: string[]; acea: string[]; api: string[]; approvals: string[];
  capacityMin: number; capacityMax: number;
};
/** What a product listing states about an engine oil, read from its name and enrichment specifications. */
export type ProductOilSpec = { viscosities: string[]; acea: string[]; text: string };
export type OilFilter = "viscosity" | "approval";
export const oilFilters: readonly OilFilter[] = ["viscosity", "approval"];

// Trodo's engine-oil category; name-detected oils are listed in it too (catalog.ts).
export const engineOilCategoryId = 957;

const viscosityGrades = "(0|5|10|15|20|25)W(?:\\s?-\\s?)?(8|16|20|30|40|50|60)";
const viscosityPattern = () => new RegExp(`(?<![0-9A-Z.])${viscosityGrades}(?![0-9])`, "g");
// SQL prefilter for the same grades (POSIX regex: no lookbehind). Bulbs ("12V 5W 67") never put a dash or nothing
// between the grades, motorcycle, gear and hydraulic oils are not engine oils for cars.
export const engineOilNameSql = `(^|[^0-9A-Z.])${viscosityGrades.replaceAll("(?:", "(")}([^0-9]|$)`;
export const plainEngineOilNameSql = "MOTOR\\s*YA[GĞ]I";
export const notEngineOilNameSql = "MOTOS[Iİ]KLET|SCOOTER|[SŞ]ANZIMAN|D[Iİ][SŞ]L[Iİ]|H[Iİ]DROL[Iİ]K|AMPUL|LAMBA|SENS[OÖ]R|F[Iİ]LTRE|\\m[24]T\\M";
// Enrichment keys whose values describe the oil itself; the rest (EAN, volume…) would add noise to the text.
export const oilSpecificationKeys = ["SAE viscosity class", "Viscosity", "Oil Viscosity Classification SAE", "ACEA specification",
  "API specification", "Oil specification", "Specification", "Trade numbers"];

const upper = (value: string) => value.toLocaleUpperCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/İ/g, "I");
const unique = (values: string[]) => [...new Set(values)];

export function normalizeViscosity(value: string) {
  const match = new RegExp(`^${viscosityGrades}$`).exec(upper(value).replace(/^SAE\s*/, "").trim());
  return match ? `${match[1]}W-${match[2]}` : null;
}

/** "ACEA A3/B4", "C2-16", "C2/C3": sequences A/B and C classes, the year suffix dropped. */
function aceaClasses(text: string) {
  const classes: string[] = [];
  for (const match of text.matchAll(/(?<![0-9A-Z])(?:(A\d)\s*\/\s*(B\d)|(C\d))(?:-\d{2})?(?![0-9A-Z])/g))
    classes.push(match[3] ?? `${match[1]}/${match[2]}`);
  return classes;
}

/**
 * Approvals are matched by containment in the product's compacted text: "VW 504 00", "VW 504.00" and
 * "VW50400" all read "VW50400"; "BMW LL-04" and "BMW Longlife-04" read "BMWLL04". The maker word is
 * dropped where product names leave it out ("RN0720", "dexos2", "WSS-M2C948-B", "9.55535-S1").
 */
function compact(value: string) {
  return upper(value).replace(/LONGLIFE/g, "LL").replace(/MERCEDES(-BENZ)?/g, "MB").replace(/[^A-Z0-9]/g, "");
}
export function approvalKey(approval: string) {
  return compact(upper(approval).replace(/^(RENAULT|GM|FIAT|FORD)\s+/, ""));
}

export function productOilSpec(name: string, specifications = ""): ProductOilSpec | null {
  const text = upper(`${name} ${specifications}`);
  const viscosities = unique([...text.matchAll(viscosityPattern())].map(match => `${match[1]}W-${match[2]}`));
  return viscosities.length ? { viscosities, acea: unique(aceaClasses(text)), text: compact(text) } : null;
}

/** Viscosity: one of the vehicle's grades. Approval: one of its ACEA classes or manufacturer approvals. */
export function oilMatches(product: ProductOilSpec, vehicle: VehicleOilSpec, filters: ReadonlySet<OilFilter>) {
  if (filters.has("viscosity") && !product.viscosities.some(value => vehicle.viscosities.includes(value))) return false;
  if (filters.has("approval") && !product.acea.some(value => vehicle.acea.includes(value))
    && !vehicle.approvals.some(approval => product.text.includes(approvalKey(approval)))) return false;
  return true;
}

export function parseOilFilters(value: string | undefined): Set<OilFilter> {
  return new Set((value ?? "").split(",").filter((filter): filter is OilFilter => (oilFilters as readonly string[]).includes(filter)));
}
export function oilFilterParam(filters: ReadonlySet<OilFilter>) {
  return oilFilters.filter(filter => filters.has(filter)).join(",") || undefined;
}

const litres = (value: number) => value.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function oilCapacity(spec: Pick<VehicleOilSpec, "capacityMin" | "capacityMax">) {
  return spec.capacityMin === spec.capacityMax ? `${litres(spec.capacityMin)} L` : `${litres(spec.capacityMin)}–${litres(spec.capacityMax)} L`;
}

/** One row of data/vehicle_type_oil_specs.csv (the TecDoc oil-capacity sheet), normalised for the table. */
export function parseVehicleOilRow(row: Record<string, string>) {
  const id = Number(row.id);
  if (!/^\d+$/.test(row.id) || !Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid vehicle type id: ${row.id}`);
  const list = (value: string, prefix?: RegExp) => unique((prefix ? value.replace(prefix, "") : value).split(",").map(item => item.trim()).filter(Boolean));
  const viscosities = list(row.viscosity).map(value => {
    const grade = normalizeViscosity(value);
    if (!grade) throw new Error(`Invalid viscosity for vehicle ${id}: ${value}`);
    return grade;
  });
  if (!viscosities.length) throw new Error(`Missing viscosity for vehicle ${id}`);
  const acea = list(row.acea, /^\s*ACEA\s+/i).map(value => {
    const classes = aceaClasses(upper(value));
    if (classes.length !== 1) throw new Error(`Invalid ACEA class for vehicle ${id}: ${value}`);
    return classes[0];
  });
  const capacity = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(?:L|Litre)$/i.exec(row.capacity.trim());
  if (!capacity) throw new Error(`Invalid oil capacity for vehicle ${id}: ${row.capacity}`);
  const capacityMin = Number(capacity[1]), capacityMax = Number(capacity[2] ?? capacity[1]);
  if (!(capacityMin > 0) || capacityMax < capacityMin || capacityMax >= 1000) throw new Error(`Invalid oil capacity for vehicle ${id}: ${row.capacity}`);
  return { vehicle_type_id: id, viscosities, acea, api: list(row.api, /^\s*API\s+/i), approvals: list(row.specifications),
    capacity_min_l: capacityMin, capacity_max_l: capacityMax };
}
