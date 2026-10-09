import test from "node:test";
import assert from "node:assert/strict";
import { matchesSupplierPart, enrichmentImportSchema, matchesEnrichment } from "../src/modules/store/enrichment-contract";
import { readFileSync } from "node:fs";

test("supplier prefix and manufacturer aliases can match the same part", () => {
  assert.equal(matchesSupplierPart("DEPO", "DPO 445-1134RMLDEM2", "DEPO", "445-1134RMLDEM2"), true);
  assert.equal(matchesSupplierPart("LUK", "LUK 510 0207 10", "LuK", "510020710"), true);
  assert.equal(matchesSupplierPart("FEBI", "FEBI 104620", "FEBI BILSTEIN", "104620"), true);
  assert.equal(matchesSupplierPart("MANN", "MANN W 7041", "MANN-FILTER", "W 7041"), true);
  assert.equal(matchesSupplierPart("LEMFORDER", "LEM 29930 02", "LEMFÖRDER", "29930 02"), true);
  assert.equal(matchesSupplierPart("BOSCH", "BCH 0258017001", "BOSCH", "0 258 017 001"), true);
  assert.equal(matchesSupplierPart("DENSO", "DEN DF-129", "DENSO", "DF-129"), true);
  assert.equal(matchesSupplierPart("FILTRON", "FILT OE 672/10", "FILTRON", "OE672/10"), true);
  assert.equal(matchesSupplierPart("DAYCO", "DAY 6PK1570HD", "DAYCO", "6PK1570HD"), true);
  assert.equal(matchesSupplierPart("TEXTAR", "TX 2614201", "TEXTAR", "2614201"), true);
  assert.equal(matchesSupplierPart("BLUE PRINT", "BLU ADBP210047", "BLUE PRINT", "ADBP210047"), true);
});
test("exact-part matching rejects a different part or manufacturer", () => {
  assert.equal(matchesSupplierPart("DEPO", "DPO 445-1134RMLDEM2", "DEPO", "445-1134LMLDEM2"), false);
  assert.equal(matchesSupplierPart("DEPO", "DPO 445-1134RMLDEM2", "TYC", "445-1134RMLDEM2"), false);
  assert.equal(matchesSupplierPart("OTHER", "ABC 104620", "OTHER", "104620"), false);
  assert.equal(matchesSupplierPart("MANN", "MANN W 7041", "MAHLE", "W 7041"), false);
  assert.equal(matchesSupplierPart("FILTRON", "FILT OE 672/10", "HART", "OE672/10"), false);
  assert.equal(matchesSupplierPart("FILTRON", "FILT OE 672/10", "FILTRON", "OE672/11"), false);
  assert.equal(matchesSupplierPart("FILTRON", "XYZ OE 672/10", "FILTRON", "OE672/10"), false);
});
test("import contracts reject invalid dates and preserve OEM versus cross references", () => {
  const seed = JSON.parse(readFileSync("tests/fixtures/enrichment-import.json", "utf8"));
  const parsed = enrichmentImportSchema.parse(seed);
  assert.equal(parsed.data.vehicles.length, 43);
  assert.deepEqual(parsed.data.oemNumbers.SEAT, ["5F1941006", "5F1941006A", "5F1941006B"]);
  assert.deepEqual(parsed.data.crossReferences.ALKAR, ["2772102"]);
  seed.data.vehicles[0].to = null;
  assert.equal(enrichmentImportSchema.safeParse(seed).success, true);
  seed.data.vehicles[0].from = "13/2013";
  assert.equal(enrichmentImportSchema.safeParse(seed).success, false);
});

test("electric fitments accept zero displacement without allowing incomplete combustion engines", () => {
  const seed = JSON.parse(readFileSync("tests/fixtures/enrichment-import.json", "utf8"));
  seed.data.vehicles[0].cc = 0;
  seed.data.vehicles[0].fuel = "Electric";
  assert.equal(enrichmentImportSchema.safeParse(seed).success, true);
  seed.data.vehicles[0].fuel = "Petrol";
  assert.equal(enrichmentImportSchema.safeParse(seed).success, false);
  seed.data.vehicles[0].fuel = "Electric";
  seed.data.vehicles[0].cc = -1;
  assert.equal(enrichmentImportSchema.safeParse(seed).success, false);
});


test("OEM matching requires current supplier reference and source proof", () => {
  const source = { manufacturer: "BorgWarner", partNumber: "16359880057", data: {
    specifications: [], oemNumbers: { RENAULT: ["144108425R"] }, crossReferences: {}, vehicles: [], vehicleModels: [], imageWidth: 480, imageHeight: 480,
  }, matchBasis: { type: "oem_reference" as const, reference: "144108425R", supplierOem: "144108425R", referenceSource: "supplier_oem" as const } };
  const supplier = { brand: "KKK", code: "KKK 16359880057", oem: "144108425R" };
  assert.equal(matchesEnrichment(supplier, source), true);
  assert.equal(matchesEnrichment({ ...supplier, oem: "144108426R" }, source), false);
  assert.equal(matchesEnrichment(supplier, { ...source, data: { ...source.data, oemNumbers: {} } }), false);
  assert.equal(matchesEnrichment({ brand: "OPAR", code: "FIAT 51736774", oem: "51736774 7782831" }, {
    ...source, partNumber: "7782831", matchBasis: { ...source.matchBasis, reference: "7782831", supplierOem: "51736774 7782831" },
  }), true);
  assert.equal(matchesEnrichment({ brand: "OE-OPEL", code: "93177741", oem: "" }, {
    ...source, partNumber: "93177741", matchBasis: { ...source.matchBasis, reference: "93177741", supplierOem: "", referenceSource: "original_manufacturer_part_code" },
  }), true);
  assert.equal(matchesEnrichment({ brand: "OE-OPEL", code: "93177741", oem: "1744002" }, {
    ...source, partNumber: "93177741", matchBasis: { ...source.matchBasis, reference: "93177741", supplierOem: "1744002", referenceSource: "original_manufacturer_part_code" },
  }), true);
  assert.equal(matchesEnrichment({ brand: "LOCAL", code: "93177741", oem: "" }, {
    ...source, partNumber: "93177741", matchBasis: { ...source.matchBasis, reference: "93177741", supplierOem: "", referenceSource: "original_manufacturer_part_code" },
  }), false);
});

test("Opel supplier item can use BLIC data with persisted OEM proof while preserving supplier identity", () => {
  const supplier = { brand: "OE-OPEL", code: "13149561", oem: "1400307" };
  const source = { manufacturer: "BLIC", partNumber: "6502-07-5052996LQ", data: {
    specifications: [], oemNumbers: { OPEL: ["1400307"] }, crossReferences: {}, vehicles: [], vehicleModels: [], imageWidth: 480, imageHeight: 480,
  }, matchBasis: { type: "oem_reference" as const, reference: "1400307", supplierOem: "1400307", referenceSource: "supplier_oem" as const } };
  assert.equal(matchesSupplierPart(supplier.brand, supplier.code, source.manufacturer, source.partNumber), false);
  assert.equal(matchesEnrichment(supplier, source), true);
  assert.equal(matchesEnrichment({ ...supplier, oem: "1400308" }, source), false);
  assert.equal(matchesEnrichment(supplier, { ...source, data: { ...source.data, oemNumbers: {} } }), false);
});
