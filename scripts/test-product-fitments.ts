import test from "node:test";
import assert from "node:assert/strict";
import { createFitmentMatcher, type FitmentCatalogModel, type FitmentCatalogType, type SourceVehicle } from "../src/modules/store/fitment-matcher";

const models: FitmentCatalogModel[] = [{ id: 1, brand_id: 2, brand: "VW", display_brand: "VOLKSWAGEN", name: "GOLF (5G1)" }];
const base: FitmentCatalogType = { id: 10, model_id: 1, name: "2.0 TDI", cc: 1968, fuel_type: "Diesel", hp: 150, kwt: 110, date_from: "2013-04", date_to: "2017-03" };
const source: SourceVehicle = { model: "VW GOLF (5G1)", engineAndCodes: "2.0 TDI CRBC; CRLB", cc: 1968, fuel: "Diesel", ps: 150, kw: 110, from: "04/2013", to: "03/2017" };

test("strict match preserves source codes and resolves catalog brand aliases", () => {
  const match = createFitmentMatcher(models, [base]);
  assert.equal(match(source, 3).typeId, 10);
  assert.equal(match({ ...source, model: "volkswagen  golf (5g1)" }, 0).typeId, 10);
  assert.equal(match(source, 3).sourceIndex, 3);
  assert.deepEqual(match(source, 3).source, source);
});
test("drivetrain variants choose the longest name and cannot fall back to base engine", () => {
  const variant = { ...base, id: 11, name: "2.0 TDI 4motion" };
  const vehicle = { ...source, engineAndCodes: "2.0 TDI 4motion CRBC" };
  assert.equal(createFitmentMatcher(models, [base, variant])(vehicle, 0).typeId, 11);
  assert.equal(createFitmentMatcher(models, [base])(vehicle, 0).status, "engine_name_differs");
  assert.equal(createFitmentMatcher(models, [variant])(source, 0).typeId, null);
});
test("date, power, fuel and model differences must remain unlinked", () => {
  const match = createFitmentMatcher(models, [base]);
  assert.equal(match({ ...source, to: null }, 0).status, "dates_differ");
  assert.equal(match({ ...source, from: "05/2013" }, 0).status, "dates_differ");
  assert.equal(match({ ...source, ps: 149 }, 0).status, "attributes_missing");
  assert.equal(match({ ...source, fuel: "Petrol" }, 0).status, "attributes_missing");
  assert.equal(match({ ...source, model: "VW GOLF (OTHER)" }, 0).status, "model_missing");
});
test("duplicate catalog candidates are ambiguous rather than arbitrarily chosen", () => {
  const result = createFitmentMatcher(models, [base, { ...base, id: 12 }])(source, 0);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.typeId, null);
  assert.deepEqual(result.candidateTypeIds, [10, 12]);
});
test("unknown source engine cannot be linked by matching numerical specifications", () => {
  assert.equal(createFitmentMatcher(models, [base])({ ...source, engineAndCodes: "Different engine ABC" }, 0).status, "engine_name_differs");
});

test("electric zero displacement matches catalog absence while all other attributes stay strict", () => {
  const electric = { ...base, name: "Electric", cc: null, fuel_type: "Electric" };
  const vehicle = { ...source, engineAndCodes: "Electric Y4F1", cc: 0, fuel: "Electric" };
  const match = createFitmentMatcher(models, [electric]);
  assert.equal(match(vehicle, 0).typeId, 10);
  assert.equal(match({ ...vehicle, fuel: "Petrol" }, 0).typeId, null);
  assert.equal(match({ ...vehicle, cc: 1390 }, 0).typeId, null);
  assert.equal(match({ ...vehicle, ps: 149 }, 0).typeId, null);
  assert.equal(match({ ...vehicle, to: null }, 0).typeId, null);
  assert.equal(createFitmentMatcher(models, [{ ...base, cc: null }])({ ...source, cc: 0 }, 0).typeId, null);
});
