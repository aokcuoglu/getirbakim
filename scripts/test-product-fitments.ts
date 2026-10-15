import test from "node:test";
import assert from "node:assert/strict";
import { createFitmentMatcher, englishModelName, type FitmentCatalogModel, type FitmentCatalogType, type SourceVehicle } from "../src/modules/store/fitment-matcher";

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
  assert.equal(match({ ...source, to: "04/2017" }, 0).status, "dates_differ");
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
  assert.equal(match({ ...vehicle, to: "04/2017" }, 0).typeId, null);
  assert.equal(createFitmentMatcher(models, [{ ...base, cc: null }])({ ...source, cc: 0 }, 0).typeId, null);
});
test("Turkish series and body names resolve to the catalog's TecDoc names, but the given name wins", () => {
  const catalog: FitmentCatalogModel[] = [
    { id: 2, brand_id: 3, brand: "MERCEDES-BENZ", display_brand: "MERCEDES-BENZ", name: "C-CLASS T-Model (S205)" },
    { id: 3, brand_id: 4, brand: "OPEL", display_brand: "OPEL", name: "ASTRA G Estate Van (F70)" },
    { id: 4, brand_id: 5, brand: "RENAULT", display_brand: "RENAULT", name: "MEGANE I Kombi van (KA_)" },
    { id: 5, brand_id: 6, brand: "FIAT", display_brand: "FIAT", name: "DOBLO Box Body/MPV (223_)" },
  ];
  const types = [2, 3, 4, 5].map(model_id => ({ ...base, id: 100 + model_id, model_id }));
  const match = createFitmentMatcher(catalog, types);
  assert.equal(match({ ...source, model: "MERCEDES-BENZ C-SERISI T-Model (S205)" }, 0).typeId, 102);
  assert.equal(match({ ...source, model: "OPEL ASTRA G Kombi van (F70)" }, 0).typeId, 103);
  assert.equal(match({ ...source, model: "RENAULT MEGANE I Kombi van (KA_)" }, 0).typeId, 104);
  assert.equal(match({ ...source, model: "FIAT DOBLO Kasa/büyük limuzin (223_)" }, 0).typeId, 105);
  assert.equal(englishModelName("FORD TRANSIT Minibüs/Otobüs (FD_ _)"), "FORD TRANSIT BUS (FD_ _)");
  assert.equal(englishModelName("RENAULT MASTER III Platform şasi (EV, HV, UV)"), "RENAULT MASTER III PLATFORM/CHASSIS (EV, HV, UV)");
  assert.equal(englishModelName("AUDI A4 Sedan (8E2)"), "AUDI A4 SALOON (8E2)");
  assert.equal(match({ ...source, model: "MERCEDES-BENZ E-SERISI (W211)" }, 0).status, "model_missing");
});
test("an open-ended source may match a closed catalog type only on the same start and attributes", () => {
  const open = { ...source, to: null };
  assert.equal(createFitmentMatcher(models, [base])(open, 0).typeId, 10);
  assert.equal(createFitmentMatcher(models, [base])({ ...open, from: "05/2013" }, 0).status, "dates_differ");
  assert.equal(createFitmentMatcher(models, [base])({ ...open, ps: 149 }, 0).status, "attributes_missing");
  assert.equal(createFitmentMatcher(models, [base, { ...base, id: 12, date_to: "2019-01" }])(open, 0).status, "ambiguous");
  // An exact open-ended type still wins over a closed one.
  assert.equal(createFitmentMatcher(models, [base, { ...base, id: 13, date_to: null }])(open, 0).typeId, 13);
  // The reverse — a closed source against an open catalog type — still differs.
  assert.equal(createFitmentMatcher(models, [{ ...base, date_to: null }])(source, 0).status, "dates_differ");
});
