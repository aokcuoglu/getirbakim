/** Recommended engine oil of a vehicle type (db/vehicle-oil-specs.sql); any part may be unknown, the capacity as a whole. */
export type VehicleOilSpec = {
  viscosities: string[]; acea: string[]; api: string[]; approvals: string[];
  capacityMin: number | null; capacityMax: number | null;
};
/** What a product listing states about an engine oil, read from its name and enrichment specifications. */
export type ProductOilSpec = { viscosities: string[]; acea: string[]; text: string };
export type OilFilter = "viscosity" | "approval";
export const oilFilters: readonly OilFilter[] = ["viscosity", "approval"];

// Trodo's engine-oil category; name-detected oils are listed in it too (catalog.ts).
export const engineOilCategoryId = 957;

const viscosityGrades = "(0|5|10|15|20|25)W(?:\\s?-\\s?)?(8|12|16|20|30|40|50|60)";
// Single grades ("SAE 30") only with the SAE prefix: a bare "30" or "40" in a product name is anything.
const monogradePattern = () => /(?<![0-9A-Z])SAE\s?(20|30|40|50|60)(?![0-9W])/g;
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

/** "SAE 5W30" → "5W-30"; single grades "SAE 30" (TecRMI also writes "SAE 30W") → "30". */
export function normalizeViscosity(value: string) {
  const grade = upper(value).replace(/^SAE\s*/, "").trim();
  const match = new RegExp(`^${viscosityGrades}$`).exec(grade);
  if (match) return `${match[1]}W-${match[2]}`;
  return /^(20|30|40|50|60)W?$/.exec(grade)?.[1] ?? null;
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
  const viscosities = unique([...[...text.matchAll(viscosityPattern())].map(match => `${match[1]}W-${match[2]}`),
    ...[...text.matchAll(monogradePattern())].map(match => match[1])]);
  return viscosities.length ? { viscosities, acea: unique(aceaClasses(text)), text: compact(text) } : null;
}

/** The filters the vehicle's data can answer: no grades, no viscosity filter; no ACEA class or approval, no approval filter. */
export function vehicleOilFilters(vehicle: VehicleOilSpec): OilFilter[] {
  return oilFilters.filter(filter => filter === "viscosity" ? vehicle.viscosities.length > 0 : vehicle.acea.length + vehicle.approvals.length > 0);
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
/** "4,5 L" / "4,5–5,4 L"; null when the capacity is unknown. */
export function oilCapacity(spec: Pick<VehicleOilSpec, "capacityMin" | "capacityMax">) {
  if (spec.capacityMin === null || spec.capacityMax === null) return null;
  return spec.capacityMin === spec.capacityMax ? `${litres(spec.capacityMin)} L` : `${litres(spec.capacityMin)}–${litres(spec.capacityMax)} L`;
}

/**
 * One row of data/vehicle_type_oil_specs.csv, normalised for the table. Viscosity and capacity may be empty, but
 * a row says something: a grade, a capacity, an ACEA/API class or an approval.
 */
export function parseVehicleOilRow(row: Record<string, string>) {
  const id = Number(row.id);
  if (!/^\d+$/.test(row.id) || !Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid vehicle type id: ${row.id}`);
  const list = (value: string, prefix?: RegExp) => unique((prefix ? value.replace(prefix, "") : value).split(",").map(item => item.trim()).filter(Boolean));
  const viscosities = list(row.viscosity).map(value => {
    const grade = normalizeViscosity(value);
    if (!grade) throw new Error(`Invalid viscosity for vehicle ${id}: ${value}`);
    return grade;
  });
  const acea = list(row.acea, /^\s*ACEA\s+/i).map(value => {
    const classes = aceaClasses(upper(value));
    if (classes.length !== 1) throw new Error(`Invalid ACEA class for vehicle ${id}: ${value}`);
    return classes[0];
  });
  let capacityMin: number | null = null, capacityMax: number | null = null;
  if (row.capacity.trim()) {
    const capacity = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(?:L|Litre)$/i.exec(row.capacity.trim());
    if (!capacity) throw new Error(`Invalid oil capacity for vehicle ${id}: ${row.capacity}`);
    capacityMin = Number(capacity[1]); capacityMax = Number(capacity[2] ?? capacity[1]);
    if (!(capacityMin > 0) || capacityMax < capacityMin || capacityMax >= 1000) throw new Error(`Invalid oil capacity for vehicle ${id}: ${row.capacity}`);
  }
  const api = list(row.api, /^\s*API\s+/i), approvals = list(row.specifications);
  if (!viscosities.length && !acea.length && !api.length && !approvals.length && capacityMin === null) throw new Error(`Empty oil row for vehicle ${id}`);
  return { vehicle_type_id: id, viscosities, acea, api, approvals, capacity_min_l: capacityMin, capacity_max_l: capacityMax };
}

export type VehicleOilSheetRow = { id: string; viscosity: string; acea: string; api: string; specifications: string; capacity: string; source: string };
export type TrodoOil = { volumes: string[]; viscosities: string[]; specifications: string[] };

/**
 * Trodo's oil data for a car (TecRMI: "3,70", "SAE 5W-30", "VW 507 00" / "API SL" / "ACEA C3") as a sheet row; the
 * parts Trodo lacks stay empty, null when nothing is usable. Several volumes become a range.
 */
export function trodoOilSheetRow(id: number, oil: TrodoOil): VehicleOilSheetRow | null {
  const volumes = oil.volumes.map(value => Number(value.trim().replace(",", "."))).filter(value => value > 0 && value < 1000);
  const viscosities = unique(oil.viscosities.map(normalizeViscosity).filter(value => value !== null));
  const acea: string[] = [], api: string[] = [], approvals: string[] = [];
  for (const raw of oil.specifications.map(value => value.trim()).filter(Boolean)) {
    const value = upper(raw);
    const classes = /^ACEA\s/.test(value) || /^(?:A\d\s*\/\s*B\d|C\d)(?:-\d{2})?$/.test(value) ? aceaClasses(value) : [];
    if (/^API\s/.test(value)) api.push(...value.replace(/^API\s+/, "").split(/[/,]/).map(item => item.trim()).filter(Boolean));
    else if (classes.length) acea.push(...classes);
    // Truck classes (ACEA E7) and the rest are listed as approvals; a comma would split the sheet's list.
    else approvals.push(raw.replace(/\s*,\s*/g, " "));
  }
  if (!volumes.length && !viscosities.length && !acea.length && !api.length && !approvals.length) return null;
  const min = Math.min(...volumes), max = Math.max(...volumes);
  return { id: String(id), viscosity: viscosities.join(", "), acea: acea.length ? `ACEA ${unique(acea).join(", ")}` : "",
    api: api.length ? `API ${unique(api).join(", ")}` : "", specifications: unique(approvals).join(", "),
    capacity: !volumes.length ? "" : min === max ? `${min} Litre` : `${min} - ${max} Litre`, source: "trodo" };
}

const sheetColumns = ["id", "viscosity", "acea", "api", "specifications", "capacity", "source"] as const;
/** data/vehicle_type_oil_specs.csv: quoted text fields, rows in vehicle type order. */
export function vehicleOilSheet(rows: VehicleOilSheetRow[]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [sheetColumns.map(quote).join(","),
    ...[...rows].sort((a, b) => Number(a.id) - Number(b.id)).map(row => sheetColumns.map(column => column === "id" ? row.id : quote(row[column])).join(","))].join("\n") + "\n";
}
