// Readable vehicle names for every visitor-facing garage, vehicle picker and fitment label (#689). TecDoc writes makes
// and series in capitals ("VOLKSWAGEN", "GOLF VII (5G1, BQ1, BE1, BE2)"); the store prints "Volkswagen" and
// "Golf VII (5G1, BQ1, BE1, BE2)", the spelling of the listing pages (#685). Labels are derived at render time: the stored
// make and model (garage rows, cookies, keys, `fits` filtering, fitment matching) stay the catalog's own values.
//
// Server side only: this module reaches the Turkish word dictionary of product-name.ts, which must stay out of client
// bundles. Client components receive the labels as fields (`makeLabel`, `modelLabel`, `label`) and never import it
// (scripts/test-vehicle-label.ts reads their imports).
import { readableProductName } from "./product-name";

/** A make in reading form: "VOLKSWAGEN" → "Volkswagen", "MERCEDES-BENZ" → "Mercedes-Benz", "BMW" stays (the rule of product names). */
export const vehicleMakeLabel = (name: string) => readableProductName(name);

/**
 * A model series or a "<make> <model>" text in reading form. Words are converted one by one with the product-name rule
 * (codes, roman numerals and abbreviations stay), and the chassis codes in brackets stay as written:
 * "GOLF VII (5G1, BQ1)" → "Golf VII (5G1, BQ1)"; a word with a lower case letter ("Variant", "T-Model") is kept.
 */
export function vehicleSeriesLabel(name: string): string {
  return name.trim().split(/(\([^)]*\)?)/).map((part, index) => index % 2 ? part
    : part.split(" ").map(word => word && readableProductName(word)).join(" ")).join("");
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

/** The labels of a product page's fitment row ("<make> <model>" as the enrichment writes it). */
export function fitmentLabels(vehicle: { model: string | null; catalogBrand?: string | null }) {
  const model = vehicle.model ?? "";
  return { modelLabel: vehicleSeriesLabel(model), makeLabel: vehicleMakeLabel(vehicle.catalogBrand || model.split(" ")[0] || "") };
}
