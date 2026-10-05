import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeVehicleSearch } from "./vehicle-catalog";

// Read CSV quoting correctly: model/type names can contain commas and escaped quotes.
export function parseVehicleCsv(source: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(field); field = "";
      if (c !== ",") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === "\r" && source[i + 1] === "\n") i++;
      }
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed quote in vehicle CSV");
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  if (!headers) throw new Error("Empty vehicle CSV");
  return rows.map(values => {
    if (values.length !== headers.length) throw new Error("Invalid vehicle CSV row");
    return Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ""), values[index]]));
  });
}

export const popularBrands = new Set(["AUDI", "BMW", "MERCEDES-BENZ", "OPEL", "PEUGEOT", "RENAULT", "SKODA", "TOYOTA", "VW", "VOLVO"]);
export const vehicleFuelNames: Record<string, string> = {
  Petrol: "Benzin", Diesel: "Dizel", Electric: "Elektrik", Mixture: "Karışım",
  "Petrol/Electric": "Benzin / Elektrik", "Diesel/Electro": "Dizel / Elektrik",
  "Petrol/Liquified Petroleum Gas (LPG)": "Benzin / LPG", "Petrol/Ethanol": "Benzin / Etanol",
  "Petrol/Compressed Natural Gas (CNG)": "Benzin / CNG", CNG: "CNG",
  "Hydrogen/electric": "Hidrojen / Elektrik", "Petrol/Ethanol/Electric": "Benzin / Etanol / Elektrik",
  Hydrogen: "Hidrojen", "Petrol/Electric/Biogas": "Benzin / Elektrik / Biyogaz",
  Ethanol: "Etanol", LPG: "LPG", "Petrol/Electric/Liquefied Petroleum Gas (LPG)": "Benzin / Elektrik / LPG",
};


const id = (value: string) => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error(`Invalid TecDoc ID: ${value}`);
  return Number(value);
};
const month = (value: string) => {
  if (!value) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`Invalid TecDoc month: ${value}`);
  return `${value}-01`;
};
const positiveInteger = (value: string) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`Invalid TecDoc numeric value: ${value}`);
  return result;
};

export async function readVehicleCatalogImport(directory = path.join(process.cwd(), "data")) {
  const [brandRows, modelRows, typeRows] = await Promise.all(
    ["vehicle_brands.csv", "vehicle_models.csv", "vehicle_types.csv"].map(async name =>
      parseVehicleCsv(await readFile(path.join(directory, name), "utf8"))),
  );
  const brands = brandRows.map(r => ({ id: id(r.id), name: r.name, display_name: r.name === "VW" ? "VOLKSWAGEN" : r.name, popular: popularBrands.has(r.name) }));
  const brandById = new Map(brands.map(b => [b.id, b]));
  const models = modelRows.map(r => ({ id: id(r.id), brand_id: id(r.brand_id), name: r.name, date_from: month(r.date_from), date_to: month(r.date_to) }));
  const modelById = new Map(models.map(m => [m.id, m]));
  const vehicles = typeRows.map(r => {
    const model = modelById.get(id(r.model_id));
    const brand = model && brandById.get(model.brand_id);
    if (!model || !brand) throw new Error(`Broken TecDoc relationship for vehicle ${r.id}`);
    const fuelName = vehicleFuelNames[r.fuel_type];
    if (!fuelName) throw new Error(`Unmapped TecDoc fuel: ${r.fuel_type}`);
    const hp = positiveInteger(r.hp), kwt = positiveInteger(r.kwt);
    const cc = r.cc ? positiveInteger(r.cc) : null;
    return { id: id(r.id), model_id: model.id, name: r.name, cc, fuel_type: r.fuel_type, fuel_name: fuelName,
      hp, kwt, year_of_constr_from: month(r.year_of_constr_from), year_of_constr_to: month(r.year_of_constr_to),
      search_text: normalizeVehicleSearch([brand.display_name, brand.name, model.name, r.name, fuelName, r.fuel_type,
        fuelName.includes("Elektrik") && fuelName.includes("/") ? "hibrit hybrid" : "", `${hp} hp / ${kwt} kW`, cc ?? ""].join(" ")) };
  });
  for (const [name, rows] of [["brands", brands], ["models", models], ["types", vehicles]] as const) {
    if (!rows.length || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error(`Empty or duplicate TecDoc ${name}`);
  }
  for (const model of models) if (!brandById.has(model.brand_id)) throw new Error(`Unknown brand for model ${model.id}`);
  return { brands, models, vehicles };
}
