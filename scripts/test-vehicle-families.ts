import assert from "node:assert/strict";
import { test } from "node:test";
import { vehicleModelFamilies, vehicleModelFamilyKey, type VehicleModel } from "../src/modules/store/vehicle-catalog";

let nextId = 1;
const model = (name: string, dateFrom: string | null = "2010-01", dateTo: string | null = "2015-01"): VehicleModel =>
  ({ id: String(nextId++), brandId: "1", name, dateFrom, dateTo });
const names = (models: VehicleModel[]) => vehicleModelFamilies(models).map(f => `${f.name}:${f.models.length}`);

test("series group into families named by their shared leading words", () => {
  assert.deepEqual(names([model("A1 (8X1, 8XK)"), model("A1 Sportback (GBA)"), model("A1 Allstreet (GBH)"),
    model("A4 B8 Avant (8K5)"), model("A4 Allroad B9 (8WH, 8WJ)"), model("A6 e-tron Avant (GH5)"), model("A6 C7 (4G2, 4GC)"),
    model("Q4 E-TRON SUV (F4B)"), model("Q4 E-TRON Sportback (F4N)"), model("100 C4 Avant (4A5)")]),
  ["100:1", "A1:3", "A4:2", "A6:2", "Q4 E-TRON:2"]);
  assert.deepEqual(names([model("RANGE ROVER SPORT II (L494)"), model("RANGE ROVER EVOQUE (L551)"), model("RANGE ROVER IV (L405)"),
    model("DISCOVERY SPORT (L550)"), model("DISCOVERY V (L462)")]), ["DISCOVERY:2", "RANGE ROVER:3"]);
  assert.deepEqual(names([model("C-CLASS T-Model (S204)"), model("C-CLASS (W205)"), model("C-CLASS T-MODEL (S206)")]), ["C-CLASS:3"]);
});

test("single series drop generation and body words; GRAND and accents are handled", () => {
  assert.deepEqual(names([model("ANTARA A (L07)"), model("GOLF VII (5G1, BQ1, BE1, BE2)"), model("T-CLASS MPV (W420)")]),
    ["ANTARA:1", "GOLF:1", "T-CLASS:1"]);
  assert.deepEqual(names([model("GRAND SCÉNIC III (JZ0/1_)"), model("GRAND KANGOO III MPV"), model("SCÉNIC IV (J9_)"), model("GRAND SCÉNIC IV (R9_)")]),
    ["GRAND KANGOO:1", "GRAND SCÉNIC:2", "SCÉNIC:1"]);
  assert.deepEqual(names([model("SANTA FÉ I (SM)"), model("SANTA FE II (CM)")]), ["SANTA FÉ:2"]);
  assert.equal(vehicleModelFamilyKey("GRAND SCÉNIC II (JM0/1_)"), "grand scenic");
  assert.equal(vehicleModelFamilyKey("A1 Sportback (8XA, 8XF)"), "a1");
});

test("families sort numerically and span their series' production dates", () => {
  const families = vehicleModelFamilies([model("100 C1", "1968-01", "1976-07"), model("80 B4", "1991-09", "1996-01"),
    model("80 B1", "1972-07", "1978-07"), model("A3 (8Y)", "2020-05", null), model("A3 (8P1)", "2003-05", "2012-08")]);
  assert.deepEqual(families.map(f => [f.name, f.dateFrom, f.dateTo]), [["80", "1972-07", "1996-01"], ["100", "1968-01", "1976-07"], ["A3", "2003-05", null]]);
});
