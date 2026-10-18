import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseVehicleCsv } from "../src/modules/store/vehicle-catalog-import";
import { approvalKey, oilCapacity, oilFilterParam, oilMatches, parseOilFilters, parseVehicleOilRow, productOilSpec, trodoOilSheetRow, vehicleOilSheet, type VehicleOilSpec } from "../src/modules/store/vehicle-oil";

const row = (fields: Partial<Record<string, string>>) => ({ id: "1", viscosity: "5W-30, 5W-40", acea: "ACEA C2, C3", api: "API SN, SP", specifications: "", capacity: "4.0 Litre", ...fields });
const golf: VehicleOilSpec = { viscosities: ["5W-30", "0W-30"], acea: ["C3"], api: ["SN"], approvals: ["VW 504.00", "VW 507.00"], capacityMin: 4.5, capacityMax: 4.5 };
const both = new Set(["viscosity", "approval"] as const);

test("sheet rows are normalised for the table", () => {
  assert.deepEqual(parseVehicleOilRow(row({ specifications: "Renault RN0720, RN17", capacity: "4.5 - 5.4 Litre" })), {
    vehicle_type_id: 1, viscosities: ["5W-30", "5W-40"], acea: ["C2", "C3"], api: ["SN", "SP"], approvals: ["Renault RN0720", "RN17"],
    capacity_min_l: 4.5, capacity_max_l: 5.4 });
  assert.deepEqual(parseVehicleOilRow(row({ acea: "ACEA A3/B4" })).acea, ["A3/B4"]);
});
test("malformed sheet values stop the import", () => {
  assert.throws(() => parseVehicleOilRow(row({ id: "x" })), /vehicle type id/);
  assert.throws(() => parseVehicleOilRow(row({ viscosity: "" })), /Missing viscosity/);
  assert.throws(() => parseVehicleOilRow(row({ viscosity: "5W30 ish" })), /Invalid viscosity/);
  assert.throws(() => parseVehicleOilRow(row({ capacity: "4 litres-ish" })), /capacity/);
  assert.throws(() => parseVehicleOilRow(row({ capacity: "5.4 - 4.5 Litre" })), /capacity/);
});
test("the checked-in sheet parses completely", async () => {
  const rows = parseVehicleCsv(await readFile("data/vehicle_type_oil_specs.csv", "utf8")).map(parseVehicleOilRow);
  assert.ok(rows.length > 7000);
  assert.equal(new Set(rows.map(row => row.vehicle_type_id)).size, rows.length);
});
test("supplier names state grades, ACEA classes and approvals in many spellings", () => {
  assert.deepEqual(productOilSpec("MOTOR YAGI TOTAL QUARTZ INEO MDC 5W30 C2 C3 3B 4 LITRE")?.viscosities, ["5W-30"]);
  assert.deepEqual(productOilSpec("MOTOR YAGI TOTAL QUARTZ INEO MDC 5W30 C2 C3 3B 4 LITRE")?.acea, ["C2", "C3"]);
  assert.deepEqual(productOilSpec("MOTOR YAGI PRESTIGE SUPER PLUS D-EC C2/C3 5W30 1L")?.acea, ["C2", "C3"]);
  assert.deepEqual(productOilSpec("MOTOR YAGI DIZEL DPF PARTIKUL NEW ENERGY 5W40 PI C3-16 4LT")?.acea, ["C3"]);
  assert.deepEqual(productOilSpec("MOTOR YAGI ELF SPORTI 7 A3/B4 10W40 12B 1 LITRE")?.acea, ["A3/B4"]);
  assert.deepEqual(productOilSpec("KRAFTVOLL MOTOR YAGI 0W-16 TAM SENTETIK C3 SN 5LT.")?.viscosities, ["0W-16"]);
  const febi = productOilSpec("MOTOR YAGI", "5W-30, ACEA C3, API SN CF, BMW LL-04, MB 229.51, VW 504 00/507 00, VW 504 00");
  assert.ok(febi?.text.includes(approvalKey("VW 504.00")) && febi.text.includes(approvalKey("BMW Longlife-04")) && febi.text.includes(approvalKey("MB 229.51")));
  assert.ok(productOilSpec("RENAULT RN 0720 5W30")?.text.includes(approvalKey("Renault RN0720")));
});
test("names without an engine-oil grade are not oils", () => {
  assert.equal(productOilSpec("AMPUL 12V 5W 21"), null);
  assert.equal(productOilSpec("10 NUMARA YAG KRAFTVOLL SAE 10W 16 LT"), null);
  assert.equal(productOilSpec("MOTOR YAGI SEVIYE SENSORU A4 13>15"), null);
});
test("each filter narrows by its own rule", () => {
  const c3 = productOilSpec("MOTOR YAGI 5W30 C3 4LT")!, a3 = productOilSpec("MOTOR YAGI 10W40 A3/B4 4LT")!;
  const vw = productOilSpec("MOTOR YAGI 5W-30 VW 504.00 5L")!, plain = productOilSpec("MOTOR YAGI 5W-30 5L")!;
  assert.equal(oilMatches(c3, golf, both), true);
  assert.equal(oilMatches(vw, golf, both), true, "an OEM approval stands in for the ACEA class");
  assert.equal(oilMatches(plain, golf, both), false, "an unstated approval is not assumed");
  assert.equal(oilMatches(plain, golf, new Set(["viscosity"])), true);
  assert.equal(oilMatches(a3, golf, new Set(["viscosity"])), false);
  assert.equal(oilMatches(a3, { ...golf, viscosities: ["10W-40"] }, new Set(["approval"])), false);
});
test("filters and litres read as the URL and the banner show them", () => {
  assert.deepEqual([...parseOilFilters("approval,viscosity,other")], ["approval", "viscosity"]);
  assert.equal(oilFilterParam(new Set(["approval", "viscosity"])), "viscosity,approval");
  assert.equal(oilFilterParam(new Set()), undefined);
  assert.equal(oilCapacity({ capacityMin: 4, capacityMax: 4 }), "4,0 L");
  assert.equal(oilCapacity({ capacityMin: 4.5, capacityMax: 5.4 }), "4,5–5,4 L");
});

test("Trodo oil data becomes a sheet row the import accepts", () => {
  const audi = trodoOilSheetRow(108165, { volumes: ["3,70"], viscosities: ["SAE 5W-30"], specifications: ["VW 507 00"] });
  assert.deepEqual(audi, { id: "108165", viscosity: "5W-30", acea: "", api: "", specifications: "VW 507 00", capacity: "3.7 Litre", source: "trodo" });
  const mixed = trodoOilSheetRow(26, { volumes: ["3,10", "3,60"], viscosities: ["SAE 5W-30", "SAE 0W-20", "SAE 5W-30"],
    specifications: ["API SL", "API SM/CF", "ACEA C2/C3", "ACEA A3/B4", "ACEA E7", "Ford WSS-M2C913-B, -C"] })!;
  assert.deepEqual(mixed, { id: "26", viscosity: "5W-30, 0W-20", acea: "ACEA C2, C3, A3/B4", api: "API SL, SM, CF",
    specifications: "ACEA E7, Ford WSS-M2C913-B -C", capacity: "3.1 - 3.6 Litre", source: "trodo" });
  assert.deepEqual(parseVehicleOilRow(mixed), { vehicle_type_id: 26, viscosities: ["5W-30", "0W-20"], acea: ["C2", "C3", "A3/B4"], api: ["SL", "SM", "CF"],
    approvals: ["ACEA E7", "Ford WSS-M2C913-B -C"], capacity_min_l: 3.1, capacity_max_l: 3.6 });
  // Without a volume or an SAE grade the vehicle keeps its oil_capacities row.
  assert.equal(trodoOilSheetRow(1, { volumes: [], viscosities: ["SAE 5W-30"], specifications: [] }), null);
  assert.equal(trodoOilSheetRow(1, { volumes: ["4,0"], viscosities: ["SAE 30"], specifications: ["API SL"] }), null);
});
test("the sheet is written back in vehicle type order", () => {
  const sheet = vehicleOilSheet([
    { id: "26", viscosity: "5W-30", acea: "", api: "", specifications: 'VW "507"', capacity: "3.6 Litre", source: "trodo" },
    { id: "3", viscosity: "5W-30", acea: "", api: "", specifications: "", capacity: "5.0 Litre", source: "oil_capacities" },
  ]);
  assert.equal(sheet, '"id","viscosity","acea","api","specifications","capacity","source"\n3,"5W-30","","","","5.0 Litre","oil_capacities"\n'
    + '26,"5W-30","","","VW ""507""","3.6 Litre","trodo"\n');
  assert.deepEqual(parseVehicleCsv(sheet).map(row => row.specifications), ["", 'VW "507"']);
});
