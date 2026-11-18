import test from "node:test";
import assert from "node:assert/strict";
import { createFitmentMatcher, englishModelName, type FitmentCatalogModel, type FitmentCatalogType, type SourceVehicle } from "../src/modules/store/fitment-matcher";
import { parseFitmentPaging } from "../src/modules/admin/fitment-details";
import { fitmentInitialGroups, fitmentView, visibleFitmentGroups, type FitmentSource } from "../src/modules/store/product-fitment-view";

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

test("fitment paging parameters default to the first page and reject unsafe values", () => {
  assert.deepEqual(parseFitmentPaging(new URLSearchParams()), { offset: 0, limit: 50, filter: "all", query: "" });
  assert.deepEqual(parseFitmentPaging(new URLSearchParams("vehiclesOffset=100&vehiclesLimit=200&vehiclesFilter=matched")), { offset: 100, limit: 200, filter: "matched", query: "" });
  for (const query of ["vehiclesOffset=-1", "vehiclesOffset=1.5", "vehiclesOffset=abc", "vehiclesLimit=0", "vehiclesLimit=201", "vehiclesLimit=1e3", "vehiclesFilter=all%27--", "vehiclesOffset=99999999999", `vehiclesQuery=${"a".repeat(101)}`]) {
    assert.equal(parseFitmentPaging(new URLSearchParams(query)), null, query);
  }
});

test("fitment search query is trimmed, empty means no search, and length is capped", () => {
  assert.equal(parseFitmentPaging(new URLSearchParams("vehiclesQuery=%20%20"))?.query, "");
  assert.equal(parseFitmentPaging(new URLSearchParams("vehiclesQuery=%20golf%20tdi%20"))?.query, "golf tdi");
  assert.equal(parseFitmentPaging(new URLSearchParams({ vehiclesQuery: "a".repeat(100) }))?.query.length, 100);
});

// The product page's "Uyumlu araçlar" view (#642).

const vehicle = (modelLabel: string, extra: Partial<FitmentSource> = {}): FitmentSource => ({ engineAndCodes: "2.0 TDI CRBC", fuel: "Diesel", ps: 150, kw: 110, cc: 1968,
  from: "04/2013", to: "03/2017", makeKey: "VOLKSWAGEN", makeLabel: "Volkswagen", modelLabel, ...extra });

test("fitmentView groups rows by model in first-seen order and keeps only the printed fields", () => {
  const view = fitmentView([
    vehicle("Volkswagen Golf VII (5G1)", { vehicleTypeId: 10, catalogEngine: "2.0 TDI", modelHref: null }),
    vehicle("Volkswagen Passat B8 (3G2)", { to: null, modelHref: "/yedek-parca/volkswagen/passat-b8" }),
    vehicle("Volkswagen Golf VII (5G1)", { engineAndCodes: "1.6 TDI", catalogEngine: "1.6 TDI", modelHref: "/yedek-parca/volkswagen/golf-vii" }),
    vehicle("Volkswagen Golf VII (5G1)", { modelHref: "/yedek-parca/volkswagen/golf-other" }),
    vehicle("Audi A3 (8V1)", { makeKey: "AUDI", makeLabel: "Audi", vehicleTypeId: null }),
  ]);
  assert.deepEqual(view.makes, [["VOLKSWAGEN", "Volkswagen"], ["AUDI", "Audi"]]);
  assert.deepEqual(view.groups.map(group => group.model), ["Volkswagen Golf VII (5G1)", "Volkswagen Passat B8 (3G2)", "Audi A3 (8V1)"]);
  assert.equal(view.total, 5);
  const [golf, passat, audi] = view.groups;
  // The first row naming a model page stands for the group.
  assert.equal(golf.href, "/yedek-parca/volkswagen/golf-vii");
  assert.equal(passat.href, "/yedek-parca/volkswagen/passat-b8");
  assert.equal("href" in audi, false);
  assert.equal(golf.make, "VOLKSWAGEN");
  assert.equal(audi.make, "AUDI");
  assert.deepEqual(golf.rows[0], { engine: "2.0 TDI CRBC", catalog: "2.0 TDI", fuel: "Diesel", ps: 150, kw: 110, cc: 1968, from: "04/2013", to: "03/2017", typeId: 10 });
  // The catalog name only where it differs; no end date and no type id are left out.
  assert.equal("catalog" in golf.rows[1], false);
  assert.equal("typeId" in golf.rows[1], false);
  assert.equal("to" in passat.rows[0], false);
  assert.equal("typeId" in audi.rows[0], false);
});

test("visibleFitmentGroups prints the first groups until showAll; filters and search lift the cap", () => {
  const sources = Array.from({ length: 25 }, (_, index) => vehicle(`Volkswagen Model ${index + 1}`));
  sources.push(vehicle("Volkswagen Golf VII (5G1)", { engineAndCodes: "1.4 TSI CZCA", ps: 125, kw: 92 }), vehicle("Audi A3 (8V1)", { makeKey: "AUDI", makeLabel: "Audi" }));
  const view = fitmentView(sources), none = { make: "", model: "", query: "", showAll: false };
  const first = visibleFitmentGroups(view, none);
  assert.equal(first.groups.length, fitmentInitialGroups);
  assert.equal(first.hidden, 27 - fitmentInitialGroups);
  assert.equal(first.matches, 27);
  const all = visibleFitmentGroups(view, { ...none, showAll: true });
  assert.equal(all.groups.length, 27);
  assert.equal(all.hidden, 0);
  const audi = visibleFitmentGroups(view, { ...none, make: "AUDI" });
  assert.deepEqual(audi.groups.map(group => group.model), ["Audi A3 (8V1)"]);
  assert.equal(audi.matches, 1);
  assert.equal(audi.hidden, 0);
  const model = visibleFitmentGroups(view, { ...none, model: "Volkswagen Model 22" });
  assert.deepEqual(model.groups.map(group => group.model), ["Volkswagen Model 22"]);
  // A make filter lists every group of the make, past the first twenty.
  assert.equal(visibleFitmentGroups(view, { ...none, make: "VOLKSWAGEN" }).groups.length, 26);
  // Turkish lower case reads "VII" as "vıı"; the search folds ı to i on both sides.
  const golf = visibleFitmentGroups(view, { ...none, query: " golf vii " });
  assert.deepEqual(golf.groups.map(group => group.model), ["Volkswagen Golf VII (5G1)"]);
  assert.equal(golf.matches, 1);
  assert.equal(visibleFitmentGroups(view, { ...none, query: "CZCA" }).matches, 1);
  assert.equal(visibleFitmentGroups(view, { ...none, query: "yok böyle" }).groups.length, 0);
  // Only matching rows of a group are printed.
  const mixed = fitmentView([vehicle("Volkswagen Golf VII (5G1)"), vehicle("Volkswagen Golf VII (5G1)", { engineAndCodes: "1.4 TSI CZCA" })]);
  assert.deepEqual(visibleFitmentGroups(mixed, { ...none, query: "tsi" }).groups[0].rows.map(row => row.engine), ["1.4 TSI CZCA"]);
});

test("fitmentView lists one make per reading label, so both spellings filter together", () => {
  const view = fitmentView([
    vehicle("Togg T10X", { makeKey: "TOGG", makeLabel: "Togg" }),
    vehicle("Togg T10F", { makeKey: "Togg", makeLabel: "Togg" }),
    vehicle("Volkswagen Golf VII (5G1)"),
  ]);
  assert.deepEqual(view.makes, [["TOGG", "Togg"], ["VOLKSWAGEN", "Volkswagen"]]);
  assert.deepEqual(view.groups.map(group => group.make), ["TOGG", "TOGG", "VOLKSWAGEN"]);
  const togg = visibleFitmentGroups(view, { make: "TOGG", model: "", query: "", showAll: false });
  assert.deepEqual(togg.groups.map(group => group.model), ["Togg T10X", "Togg T10F"]);
});

test("fitmentView puts the garage vehicle's groups first: its engine type, then its model, then its make", () => {
  const sources = Array.from({ length: 30 }, (_, index) => vehicle(`Volkswagen Model ${index + 1}`, { modelId: index + 1 }));
  sources.push(vehicle("Audi A3 (8V1)", { makeKey: "AUDI", makeLabel: "Audi", modelId: 100 }), vehicle("Audi A4 (8W2)", { makeKey: "AUDI", makeLabel: "Audi", modelId: 101 }));
  sources.push(vehicle("Volkswagen Golf VII (5G1)", { vehicleTypeId: 77, modelId: 200 }));
  const first = (garage: Parameters<typeof fitmentView>[1]) => visibleFitmentGroups(fitmentView(sources, garage), { make: "", model: "", query: "", showAll: false }).groups.map(group => group.model);
  assert.equal(first({ typeId: "77", modelId: "200", makeLabel: "Volkswagen" })[0], "Volkswagen Golf VII (5G1)");
  assert.deepEqual(first({ typeId: null, modelId: "101", makeLabel: "Audi" }).slice(0, 2), ["Audi A4 (8W2)", "Audi A3 (8V1)"]);
  assert.deepEqual(first({ typeId: "999", modelId: "999", makeLabel: "Audi" }).slice(0, 2), ["Audi A3 (8V1)", "Audi A4 (8W2)"]);
  // Without a garage vehicle, or with one of another make, the first-seen order stays.
  assert.equal(first(null)[0], "Volkswagen Model 1");
  assert.equal(first({ typeId: null, modelId: null, makeLabel: "Fiat" })[0], "Volkswagen Model 1");
});
