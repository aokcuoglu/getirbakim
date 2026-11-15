import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { garageFormChange } from "../src/modules/store/garage-form";
import { garageVehicleLabel, vehicleKey } from "../src/modules/store/garage";
import { vehicleModelFamilies, type VehicleModel } from "../src/modules/store/vehicle-catalog";
import { fitmentLabels, shownVehicle, vehicleMakeLabel, vehicleSeriesLabel, vehicleText } from "../src/modules/store/vehicle-label";
import { vehicleMakeLabel as listingMakeLabel } from "../src/modules/store/vehicle-model-groups";

// Readable vehicle names of the garage, the picker and the fitment list (#689). Makes are read from the local
// vehicle_brands, series from vehicle_models (2026-11-15).
test("makes are spelled as the listing pages spell them", () => {
  for (const [raw, label] of [["VOLKSWAGEN", "Volkswagen"], ["MERCEDES-BENZ", "Mercedes-Benz"], ["BMW", "BMW"], ["ALFA ROMEO", "Alfa Romeo"], ["CITROËN", "Citroën"],
    ["LAND ROVER", "Land Rover"], ["ROLLS-ROYCE", "Rolls-Royce"], ["LYNK & CO", "Lynk & Co"], ["FORD USA", "Ford USA"], ["KG MOBILITY", "KG Mobility"]]) {
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

const MAKES = ["ALFA ROMEO", "AUDI", "LAND ROVER", "VOLKSWAGEN", "RENAULT", "ASTON MARTIN", "KG MOBILITY", "ASIA MOTORS", "MERCEDES-BENZ"];

test("fitment rows: one make key and one model label for every spelling of a make", () => {
  const linked = fitmentLabels({ model: "VOLKSWAGEN GOLF VII (5G1)", catalogBrand: "VOLKSWAGEN" }, MAKES);
  assert.deepEqual(linked, { makeKey: "VOLKSWAGEN", makeLabel: "Volkswagen", modelLabel: "Volkswagen Golf VII (5G1)" });
  // An unlinked source row says "VW": same make key and same model label, so the filter lists one make and one model.
  assert.deepEqual(fitmentLabels({ model: "VW GOLF VII (5G1)", catalogBrand: null }, MAKES), linked);
  assert.deepEqual(fitmentLabels({ model: "Volkswagen GOLF VII (5G1)" }, MAKES), linked);
  // The longest leading words that name a catalog make: not "Alfa", "Land", "Aston", "KG", "Asia".
  for (const [model, key, label] of [["ALFA ROMEO MITO (955)", "ALFA ROMEO", "Alfa Romeo Mito (955)"], ["LAND ROVER DEFENDER", "LAND ROVER", "Land Rover Defender"],
    ["ASTON MARTIN DB9", "ASTON MARTIN", "Aston Martin DB9"], ["KG MOBILITY TORRES", "KG MOBILITY", "KG Mobility Torres"], ["ASIA MOTORS ROCSTA", "ASIA MOTORS", "Asia Motors Rocsta"],
    ["MERCEDES C-CLASS (W205)", "MERCEDES-BENZ", "Mercedes-Benz C-Class (W205)"]]) {
    const labels = fitmentLabels({ model }, MAKES);
    assert.equal(labels.makeKey, key);
    assert.equal(labels.modelLabel, label);
  }
  // A make the catalog does not know falls back to the first word; a linked row keeps its brand.
  assert.equal(fitmentLabels({ model: "RENAULT MEGANE III", catalogBrand: null }, MAKES).modelLabel, "Renault Megane III");
  assert.equal(fitmentLabels({ model: "XYZ FOO 1" }, MAKES).makeKey, "XYZ");
  assert.deepEqual(fitmentLabels({ model: null }, MAKES), { makeKey: "", makeLabel: "", modelLabel: "" });
});

test("casing exceptions: codes stay, e-tron is lower case, makes as their brands write them", () => {
  for (const [raw, label] of [["EQT", "EQT"], ["GTO", "GTO"], ["AH", "AH"], ["Q4 E-TRON (FZ)", "Q4 e-tron (FZ)"], ["MGA", "MGA"], ["MKII", "MKII"]]) assert.equal(vehicleSeriesLabel(raw), label);
  for (const [raw, label] of [["MCLAREN", "McLaren"], ["SSANGYONG", "SsangYong"], ["GAZ", "GAZ"], ["UAZ", "UAZ"], ["ZAZ", "ZAZ"], ["AMC", "AMC"], ["BAC", "BAC"],
    ["EMC", "EMC"], ["UMM", "UMM"], ["XEV", "XEV"], ["E.GO", "e.GO"]]) { assert.equal(vehicleMakeLabel(raw), label); assert.equal(listingMakeLabel(raw), label); }
  assert.equal(vehicleSeriesLabel("MCLAREN 720S"), "McLaren 720S");
});

test("the garage form: labels map back to the stored values, a catalog vehicle keeps its type", () => {
  const catalog = { make: "FIAT", model: "TIPO (356_)", year: 2018, vehicleId: "777", engine: "1.4", fuel: "Benzin", power: "95 hp", generation: "TIPO (356_)" };
  const shown = shownVehicle(catalog);
  assert.equal(shown.makeLabel, "Fiat");
  // Submitted as pre-filled (labels) and unchanged: nothing is rewritten, same key (Turkish lower casing: FIAT → "fıat", Fiat → "fiat").
  const same = garageFormChange({ make: shown.makeLabel, model: shown.modelLabel, year: 2018 }, catalog);
  assert.deepEqual(same, { kind: "keep", vehicle: catalog });
  assert.equal(vehicleKey((same as { vehicle: typeof catalog }).vehicle), vehicleKey(catalog));
  assert.notEqual(vehicleKey({ make: "FIAT", model: "TIPO", year: 2018 }), vehicleKey({ make: "Fiat", model: "TIPO", year: 2018 }));
  // Raw values submitted are as good as the labels.
  assert.equal(garageFormChange({ make: "FIAT", model: "TIPO (356_)", year: 2018 }, catalog).kind, "keep");
  // Only the year changed: the same catalog type for the new year.
  assert.deepEqual(garageFormChange({ make: shown.makeLabel, model: shown.modelLabel, year: 2019 }, catalog), { kind: "catalog-year", vehicleId: "777", year: 2019 });
  // An edited name becomes free text with the stored value of the unedited field.
  assert.deepEqual(garageFormChange({ make: shown.makeLabel, model: "Egea", year: 2018 }, catalog), { kind: "text", make: "FIAT", model: "Egea", year: 2018 });
  assert.deepEqual(garageFormChange({ make: "Fiat", model: "Egea", year: 2018 }, null), { kind: "text", make: "Fiat", model: "Egea", year: 2018 });
  // A free-text vehicle keeps its other fields when only the year changes.
  const text = { make: "Fiat", model: "Egea", year: 2018 };
  assert.deepEqual(garageFormChange({ make: "Fiat", model: "Egea", year: 2020 }, text), { kind: "keep", vehicle: { ...text, year: 2020 } });
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

// The Turkish dictionary of product-name.ts must not reach the browser: no client file may import, directly or through
// the modules it imports, the label module or the modules that import the dictionary (type-only imports are erased).
test("no client component reaches the label module or the product-name dictionary", () => {
  const forbidden = new Set(["vehicle-label", "product-name", "vehicle-model-groups", "garage", "garage-form", "vehicle-catalog.server"].map(name => join("src/modules/store", `${name}.ts`)));
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) files.push(path);
    }
  })("src");
  const exists = new Set(files);
  const resolve = (from: string, spec: string) => {
    const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
    return base && [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(candidate => exists.has(candidate));
  };
  // A "use server" file is a boundary: the browser only gets references to its actions.
  const imports = (file: string) => /^\s*["']use server["']/.test(readFileSync(file, "utf8").slice(0, 200)) ? [] : [...readFileSync(file, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].flatMap(([, spec]) => resolve(file, spec) ?? []);
  const clients = files.filter(file => /^\s*["']use client["']/.test(readFileSync(file, "utf8").slice(0, 200)));
  assert.ok(clients.length > 20 && clients.some(file => file.endsWith("vehicle-sheet.tsx")) && clients.some(file => file.endsWith("product-fitment.tsx")));
  for (const client of clients) {
    const seen = new Set<string>([client]), queue = [client];
    for (let file = queue.pop(); file; file = queue.pop()) for (const next of imports(file)) {
      assert.ok(!forbidden.has(next), `${client} reaches ${next} through ${file}`);
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
});
