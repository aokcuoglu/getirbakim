import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { garageVehicleLabel, vehicleKey } from "../src/modules/store/garage";
import { vehicleModelFamilies, type VehicleModel } from "../src/modules/store/vehicle-catalog";
import { fitmentLabels, shownVehicle, vehicleMakeLabel, vehicleSeriesLabel, vehicleText } from "../src/modules/store/vehicle-label";
import { vehicleMakeLabel as listingMakeLabel } from "../src/modules/store/vehicle-model-groups";

// Readable vehicle names of the garage, the picker and the fitment list (#689). Makes are read from the local
// vehicle_brands, series from vehicle_models (2026-11-15).
test("makes are spelled as the listing pages spell them", () => {
  for (const [raw, label] of [["VOLKSWAGEN", "Volkswagen"], ["MERCEDES-BENZ", "Mercedes-Benz"], ["BMW", "BMW"], ["ALFA ROMEO", "Alfa Romeo"], ["CITROËN", "Citroën"],
    ["LAND ROVER", "Land Rover"], ["ROLLS-ROYCE", "Rolls-Royce"], ["LYNK & CO", "LYNK & Co"], ["FORD USA", "Ford USA"], ["KG MOBILITY", "KG Mobility"]]) {
    assert.equal(vehicleMakeLabel(raw), label);
    assert.equal(vehicleMakeLabel(raw), listingMakeLabel(raw));
  }
});

test("series keep codes, roman numerals and bracketed chassis codes", () => {
  for (const [raw, label] of [
    ["GOLF VII (5G1, BQ1, BE1, BE2)", "Golf VII (5G1, BQ1, BE1, BE2)"],
    ["A4 B8 Avant (8K5)", "A4 B8 Avant (8K5)"],
    ["MEGANE III Hatchback (BZ0/1_, B3_)", "Megane III Hatchback (BZ0/1_, B3_)"],
    ["C-CLASS T-Model (S205)", "C-Class T-Model (S205)"],
    ["3 (E90)", "3 (E90)"],
    ["UP (121, 122, BL1, BL2, BL3)", "UP (121, 122, BL1, BL2, BL3)"],
    ["CLA Coupe (C117)", "CLA Coupe (C117)"],
    ["VOLKSWAGEN GOLF VII (5G1)", "Volkswagen Golf VII (5G1)"],
  ]) assert.equal(vehicleSeriesLabel(raw), label);
});

test("a vehicle keeps its stored make and model; the labels are extra fields", () => {
  const stored = { make: "VOLKSWAGEN", model: "GOLF VII (5G1, BQ1, BE1, BE2)", year: 2016, vehicleId: "12345", engine: "1.0 TSI" };
  const shown = shownVehicle(stored);
  assert.equal(shown.make, stored.make);
  assert.equal(shown.model, stored.model);
  assert.equal(shown.makeLabel, "Volkswagen");
  assert.equal(shown.modelLabel, "Golf VII (5G1, BQ1, BE1, BE2)");
  assert.equal(vehicleText(shown), "Volkswagen Golf VII (5G1, BQ1, BE1, BE2) 1.0 TSI");
  assert.equal(shownVehicle(null), null);
  // Garage keys (account rows, cookie lists) and the texts built on them follow the stored values.
  assert.equal(vehicleKey(stored), "type:12345:2016");
  assert.equal(vehicleKey({ make: "VOLKSWAGEN", model: "GOLF", year: 2016 }), "text:volkswagen|golf|2016");
  assert.equal(garageVehicleLabel(stored), "Volkswagen Golf VII (5G1, BQ1, BE1, BE2) 1.0 TSI 2016");
});

test("fitment rows: labels beside the raw values the make filter matches", () => {
  const row = { model: "VOLKSWAGEN GOLF VII (5G1)", catalogBrand: "VOLKSWAGEN" };
  assert.deepEqual(fitmentLabels(row), { modelLabel: "Volkswagen Golf VII (5G1)", makeLabel: "Volkswagen" });
  // The component's filter is `model.startsWith(`${make} `)` on the raw strings: the raw model still starts with the raw make.
  assert.ok(row.model.startsWith(`${row.catalogBrand} `));
  // Without a catalog brand the make is the model's first word, as the component derives it.
  assert.deepEqual(fitmentLabels({ model: "RENAULT MEGANE III", catalogBrand: null }), { modelLabel: "Renault Megane III", makeLabel: "Renault" });
  assert.deepEqual(fitmentLabels({ model: null }), { modelLabel: "", makeLabel: "" });
});

test("picker families group by the raw names and label by the reading form", () => {
  const model = (id: string, name: string, label: string): VehicleModel => ({ id, brandId: "1", name, label, dateFrom: "2012-08", dateTo: null });
  const families = vehicleModelFamilies([
    model("1", "GOLF VII (5G1, BQ1)", vehicleSeriesLabel("GOLF VII (5G1, BQ1)")), model("2", "GOLF VI (5K1)", vehicleSeriesLabel("GOLF VI (5K1)")),
    model("3", "PASSAT B8 (3G2)", vehicleSeriesLabel("PASSAT B8 (3G2)")), model("4", "GRAND CHEROKEE IV (WK, WK2)", vehicleSeriesLabel("GRAND CHEROKEE IV (WK, WK2)")),
  ]);
  assert.deepEqual(families.map(family => [family.key, family.name, family.label]), [["golf", "GOLF", "Golf"], ["grand cherokee", "GRAND CHEROKEE", "Grand Cherokee"], ["passat", "PASSAT", "Passat"]]);
  // Without a label (a model list that never went through the API) the family keeps its upper case name.
  assert.equal(vehicleModelFamilies([{ id: "9", brandId: "1", name: "GOLF V (1K1)", dateFrom: null, dateTo: null }])[0].label, "GOLF");
});

// The Turkish dictionary of product-name.ts must not reach the browser: no client file may import the label module or
// the modules that import it (type-only imports are erased).
test("no client component imports the label module or the product-name dictionary", () => {
  const forbidden = /^\s*import\s+(?!type\b)[^;]*from\s+["'][^"']*\/(vehicle-label|product-name|vehicle-model-groups|garage|vehicle-catalog\.server)["']/m;
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) files.push(path);
    }
  })("src");
  const clients = files.filter(file => /^\s*["']use client["']/.test(readFileSync(file, "utf8").slice(0, 200)));
  assert.ok(clients.length > 20 && clients.some(file => file.endsWith("vehicle-sheet.tsx")) && clients.some(file => file.endsWith("product-fitment.tsx")));
  for (const file of clients) assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, file);
});
