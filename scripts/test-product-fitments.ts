import test from "node:test";
import assert from "node:assert/strict";
import { createFitmentMatcher, englishModelName, type FitmentCatalogModel, type FitmentCatalogType, type SourceVehicle } from "../src/modules/store/fitment-matcher";
import { parseFitmentPaging } from "../src/modules/admin/fitment-details";
import { fitmentCacheControl, fitmentEagerModelOptions, fitmentFailureNote, fitmentInitialGroups, fitmentInlineRows, fitmentRow, fitmentRowCount, fitmentRowFields, fitmentShipsWhole, fitmentView, garageRank, initialFitmentView, isFitmentGroup, mergeFitmentGroups, visibleFitmentGroups, type FitmentSource } from "../src/modules/store/product-fitment-view";
import { fitmentSources, fitmentVersion, productFitmentGroups, productPageFitment } from "../src/modules/store/product-fitment-sources";

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
  // Rows are tuples (#1211): engine, fuel, PS, kW, cm³, from, then to, type id and catalog name when present.
  assert.deepEqual(golf.rows[0], ["2.0 TDI CRBC", "Diesel", 150, 110, 1968, "04/2013", "03/2017", 10, "2.0 TDI"]);
  assert.deepEqual(fitmentRowFields(golf.rows[0]), { engine: "2.0 TDI CRBC", catalog: "2.0 TDI", fuel: "Diesel", ps: 150, kw: 110, cc: 1968, from: "04/2013", to: "03/2017", typeId: 10 });
  // The catalog name only where it differs; no end date and no type id are left out.
  assert.deepEqual(golf.rows[1], ["1.6 TDI", "Diesel", 150, 110, 1968, "04/2013", "03/2017"]);
  assert.deepEqual(passat.rows[0], ["2.0 TDI CRBC", "Diesel", 150, 110, 1968, "04/2013"]);
  assert.equal(audi.rows[0].length, 7);
  assert.equal(fitmentRowFields(audi.rows[0]).typeId, undefined);
});

test("fitmentRow fills a gap before a present field and leaves missing trailing ones off; fitmentRowFields reads it back", () => {
  const base = { engine: "1.4 TSI CZCA", fuel: "Petrol", ps: 125, kw: 92, cc: 1395, from: "05/2014" };
  const cases = [
    [base, ["1.4 TSI CZCA", "Petrol", 125, 92, 1395, "05/2014"]],
    [{ ...base, to: "12/2018" }, ["1.4 TSI CZCA", "Petrol", 125, 92, 1395, "05/2014", "12/2018"]],
    [{ ...base, typeId: 77 }, ["1.4 TSI CZCA", "Petrol", 125, 92, 1395, "05/2014", "", 77]],
    [{ ...base, catalog: "1.4 TSI" }, ["1.4 TSI CZCA", "Petrol", 125, 92, 1395, "05/2014", "", 0, "1.4 TSI"]],
  ] as const;
  for (const [fields, row] of cases) {
    assert.deepEqual(fitmentRow(fields), row);
    assert.deepEqual(fitmentRowFields(fitmentRow(fields)), { to: undefined, typeId: undefined, catalog: undefined, ...fields });
  }
});

test("isFitmentGroup accepts tuple rows and rejects the object rows of an older deploy", () => {
  const [group] = fitmentView([vehicle("Volkswagen Golf VII (5G1)", { vehicleTypeId: 10 })]).groups;
  assert.equal(isFitmentGroup(group), true);
  assert.equal(isFitmentGroup({ ...group, rows: [] }), true);
  // The pre-#1211 answer: the same group with its rows as objects.
  assert.equal(isFitmentGroup({ ...group, rows: [fitmentRowFields(group.rows[0])] }), false);
  for (const value of [null, "x", [], { model: "Golf" }, { rows: [] }, { model: 1, rows: [] }]) assert.equal(isFitmentGroup(value), false, JSON.stringify(value));
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
  // A make filter lists every group of the make, past the printed ones.
  assert.equal(visibleFitmentGroups(view, { ...none, make: "VOLKSWAGEN" }).groups.length, 26);
  // Turkish lower case reads "VII" as "vıı"; the search folds ı to i on both sides.
  const golf = visibleFitmentGroups(view, { ...none, query: " golf vii " });
  assert.deepEqual(golf.groups.map(group => group.model), ["Volkswagen Golf VII (5G1)"]);
  assert.equal(golf.matches, 1);
  assert.equal(visibleFitmentGroups(view, { ...none, query: "CZCA" }).matches, 1);
  assert.equal(visibleFitmentGroups(view, { ...none, query: "yok böyle" }).groups.length, 0);
  // Only matching rows of a group are printed.
  const mixed = fitmentView([vehicle("Volkswagen Golf VII (5G1)"), vehicle("Volkswagen Golf VII (5G1)", { engineAndCodes: "1.4 TSI CZCA" })]);
  assert.deepEqual(visibleFitmentGroups(mixed, { ...none, query: "tsi" }).groups[0].rows.map(row => fitmentRowFields(row).engine), ["1.4 TSI CZCA"]);
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

test("garageRank ranks a row by the garage vehicle's engine type, then model, then make", () => {
  const row = vehicle("Volkswagen Golf VII (5G1)", { vehicleTypeId: 77, modelId: 200 });
  assert.equal(garageRank(row, { typeId: "77", modelId: "1", makeLabel: "Audi" }), 0);
  assert.equal(garageRank(row, { typeId: "1", modelId: "200", makeLabel: "Audi" }), 1);
  assert.equal(garageRank(row, { typeId: null, modelId: null, makeLabel: "Volkswagen" }), 2);
  assert.equal(garageRank(row, { typeId: null, modelId: null, makeLabel: "Audi" }), 3);
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

// The rest of a long list loads from /api/product-fitments/[id] (#966).

const series = (count: number, extra: (index: number) => Partial<FitmentSource> = () => ({})) =>
  Array.from({ length: count }, (_, index) => vehicle(`Volkswagen Model ${index + 1}`, { modelId: index + 1, ...extra(index) }));
const rest = "/api/product-fitments/9db4f695-185e-4d35-b8e4-190bfb549e91?v=abc";

test("initialFitmentView ships the whole view up to the first groups, then the first groups and the rest's URL", () => {
  const small = fitmentView(series(fitmentInitialGroups));
  assert.equal(initialFitmentView(small, rest), small);
  assert.equal(small.groupCount, fitmentInitialGroups);
  const view = fitmentView(series(27));
  const first = initialFitmentView(view, rest);
  assert.equal(first.groups.length, fitmentInitialGroups);
  assert.equal(first.groupCount, 27);
  assert.equal(first.total, 27);
  assert.equal(first.rest, rest);
  assert.deepEqual(first.makes, view.makes);
  // Up to fitmentEagerModelOptions groups the model select gets every [make, model] pair.
  assert.equal(first.models?.length, 27);
  assert.deepEqual(first.models?.[26], ["VOLKSWAGEN", "Volkswagen Model 27"]);
  assert.equal(initialFitmentView(fitmentView(series(fitmentEagerModelOptions)), rest).models?.length, fitmentEagerModelOptions);
  const long = initialFitmentView(fitmentView(series(fitmentEagerModelOptions + 1)), rest);
  assert.equal("models" in long, false);
  assert.equal(long.groups.length, fitmentInitialGroups);
  assert.equal(long.groupCount, fitmentEagerModelOptions + 1);
});

test("initialFitmentView keeps the garage vehicle's groups among the printed ones", () => {
  const sources = series(30);
  sources.push(vehicle("Audi A3 (8V1)", { makeKey: "AUDI", makeLabel: "Audi", vehicleTypeId: 77, modelId: 100 }));
  const view = initialFitmentView(fitmentView(sources, { typeId: "77", modelId: "100", makeLabel: "Audi" }), rest);
  assert.equal(view.groups[0].model, "Audi A3 (8V1)");
  assert.equal(view.models?.[0][1], "Audi A3 (8V1)");
  // The canonical (garage-independent) order keeps the first-seen order.
  assert.equal(fitmentView(sources).groups.at(-1)?.model, "Audi A3 (8V1)");
});

test("the page prints six model groups (#1211)", () => {
  assert.equal(fitmentInitialGroups, 6);
});

test("visibleFitmentGroups counts the groups not loaded yet as hidden", () => {
  const view = initialFitmentView(fitmentView(series(27)), rest), none = { make: "", model: "", query: "", showAll: false };
  assert.equal(visibleFitmentGroups(view, none).hidden, 27 - fitmentInitialGroups);
  // Revealing before the rest arrives still holds the unloaded groups back.
  const shown = visibleFitmentGroups(view, { ...none, showAll: true });
  assert.equal(shown.groups.length, fitmentInitialGroups);
  assert.equal(shown.hidden, 27 - fitmentInitialGroups);
  // A search reads the printed groups until the rest arrives: "Model 1" matches Model 1 only among the first ones.
  assert.equal(visibleFitmentGroups(view, { ...none, query: "Model 25" }).groups.length, 0);
  assert.deepEqual(visibleFitmentGroups(view, { ...none, query: "Model 1" }).groups.map(group => group.model), ["Volkswagen Model 1"]);
  assert.equal(visibleFitmentGroups(fitmentView(series(27)), { ...none, query: "Model 1" }).groups.length, 11);
});

test("mergeFitmentGroups keeps the printed groups first, then the loaded ones in order, once each", () => {
  const sources = series(25);
  sources.push(vehicle("Audi A3 (8V1)", { makeKey: "AUDI", makeLabel: "Audi", vehicleTypeId: 77 }));
  const canonical = fitmentView(sources).groups;
  const printed = initialFitmentView(fitmentView(sources, { typeId: "77", modelId: null, makeLabel: "Audi" }), rest).groups;
  const loaded = structuredClone(canonical);
  const merged = mergeFitmentGroups(printed, loaded);
  assert.equal(merged.length, 26);
  assert.equal(new Set(merged.map(group => group.model)).size, 26);
  printed.forEach((group, index) => assert.equal(merged[index], group));
  // The garage's Audi group and Model 1 … (fitmentInitialGroups - 1) were printed; the loaded list adds the next models.
  const next = Array.from({ length: 26 - fitmentInitialGroups }, (_, index) => `Volkswagen Model ${fitmentInitialGroups + index}`);
  assert.deepEqual(merged.slice(fitmentInitialGroups).map(group => group.model), next);
  assert.equal(merged[fitmentInitialGroups], loaded[fitmentInitialGroups - 1]);
});

test("fitmentCacheControl keeps the page's version long and any other briefly", () => {
  assert.equal(fitmentCacheControl("abc", "abc"), "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800");
  assert.equal(fitmentCacheControl("old", "abc"), "public, max-age=300");
  assert.equal(fitmentCacheControl(null, "abc"), "public, max-age=300");
  assert.equal(fitmentCacheControl("", "abc"), "public, max-age=300");
});

test("fitmentVersion is a short, stable digest of the list", () => {
  const groups = fitmentView(series(25)).groups;
  const version = fitmentVersion(groups);
  assert.match(version, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(fitmentVersion(structuredClone(groups)), version);
  assert.notEqual(fitmentVersion(groups.slice(1)), version);
  assert.notEqual(fitmentVersion([{ ...groups[0], href: "/yedek-parca/volkswagen/other" }, ...groups.slice(1)]), version);
});

test("fitmentSources labels the rows and links only the series the model page lists", () => {
  const base = { engineAndCodes: "2.0 TDI CRBC", fuel: "Diesel", ps: 150, kw: 110, cc: 1968, from: "04/2013", to: "03/2017" };
  const [linked, unlisted, unlinked] = fitmentSources([
    { ...base, model: "VOLKSWAGEN GOLF VII (5G1)", catalogBrand: "VOLKSWAGEN", modelId: 1, vehicleTypeId: 10 },
    { ...base, model: "VOLKSWAGEN PASSAT B8 (3G2)", catalogBrand: "VOLKSWAGEN", modelId: 2, vehicleTypeId: 11 },
    { ...base, model: "VW GOLF VII", catalogBrand: null, modelId: null, vehicleTypeId: null },
  ], ["VOLKSWAGEN", "AUDI"], new Set([1, 2]), new Map([[1, "/yedek-parca/volkswagen/golf-7"]]));
  assert.equal(linked.modelHref, "/yedek-parca/volkswagen/golf-7");
  assert.equal(linked.makeKey, "VOLKSWAGEN");
  assert.equal(linked.makeLabel, "Volkswagen");
  assert.equal(linked.modelLabel, "Volkswagen Golf VII (5G1)");
  // The model fits the product but its series has no page.
  assert.equal(unlisted.modelHref, null);
  assert.equal(unlinked.modelHref, null);
  assert.equal(unlinked.makeKey, "VOLKSWAGEN");
  // A series the product's model page does not list is not linked even with a path.
  assert.equal(fitmentSources([{ ...base, model: "VOLKSWAGEN GOLF VII (5G1)", catalogBrand: "VOLKSWAGEN", modelId: 1 }], ["VOLKSWAGEN"], new Set(), new Map([[1, "/x"]]))[0].modelHref, null);
});

test("the page's list URL carries the version the route answers for the same input, with or without a garage", () => {
  const base = { engineAndCodes: "2.0 TDI CRBC", fuel: "Diesel", ps: 150, kw: 110, cc: 1968, from: "04/2013", to: "03/2017" };
  const vehicles = Array.from({ length: 30 }, (_, index) => ({ ...base, model: `VOLKSWAGEN MODEL ${index + 1}`, catalogBrand: "VOLKSWAGEN", modelId: index + 1, vehicleTypeId: 100 + index }));
  vehicles.push({ ...base, model: "AUDI A3 (8V1)", catalogBrand: "AUDI", modelId: 200, vehicleTypeId: 77 });
  const input = { vehicles, makeNames: ["VOLKSWAGEN", "AUDI"], modelFits: new Set([1, 200]), modelPaths: new Map([[1, "/yedek-parca/volkswagen/model-1"]]) };
  const route = productFitmentGroups(input);
  assert.equal(route.groups.length, 31);
  const id = "9db4f695-185e-4d35-b8e4-190bfb549e91";
  const plain = productPageFitment(input, null, id);
  assert.equal(plain?.rest, `/api/product-fitments/${id}?v=${route.v}`);
  const garaged = productPageFitment(input, { typeId: "77", modelId: "200", makeLabel: "Audi" }, id);
  assert.equal(garaged?.groups[0].model, "Audi A3 (8V1)");
  assert.equal(garaged?.rest, plain?.rest);
  // The printed groups and the route's answer merge into the whole list once.
  assert.equal(mergeFitmentGroups(garaged!.groups, route.groups).length, 31);
  // A short list ships whole, without a URL.
  assert.equal(productPageFitment({ ...input, vehicles: vehicles.slice(0, 5) }, null, id)?.rest, undefined);
  assert.equal(productPageFitment({ ...input, vehicles: [] }, null, id), null);
});

// Past `fitmentInlineRows` engine rows the printed groups ship their counts only; opening one loads the list (#1324).

/** `perGroup[i]` engine rows (codes ENG<i>-<n>) for "Volkswagen Model <i + 1>". */
const engines = (perGroup: readonly number[], extra: (index: number) => Partial<FitmentSource> = () => ({})) =>
  perGroup.flatMap((count, index) => Array.from({ length: count }, (_, row) =>
    vehicle(`Volkswagen Model ${index + 1}`, { modelId: index + 1, engineAndCodes: `ENG${index + 1}-${row + 1}`, ...extra(index) })));
const none = { make: "", model: "", query: "", showAll: false };

test("the printed groups carry up to 24 engine rows (#1324)", () => {
  assert.equal(fitmentInlineRows, 24);
});

test("initialFitmentView ships up to 24 printed rows whole, past them every printed group's count only", () => {
  const whole = fitmentView(engines([4, 4, 4, 4, 4, 4]));
  assert.equal(fitmentShipsWhole(whole), true);
  assert.equal(initialFitmentView(whole, rest), whole);
  // One row more: the same six groups ship their counts, the rows load from the list's URL.
  const full = fitmentView(engines([4, 4, 4, 4, 4, 5]));
  assert.equal(fitmentShipsWhole(full), false);
  const lazy = initialFitmentView(full, rest);
  assert.equal(lazy.rest, rest);
  assert.equal("models" in lazy, false);
  assert.equal(lazy.groupCount, 6);
  assert.equal(lazy.total, 25);
  assert.deepEqual(lazy.groups.map(group => [group.rows.length, group.count]), [[0, 4], [0, 4], [0, 4], [0, 4], [0, 4], [0, 5]]);
  assert.deepEqual(lazy.groups.map(fitmentRowCount), [4, 4, 4, 4, 4, 5]);
  // Past the first groups as well: 27 models of five rows ship six headers in under 2 KB.
  const long = initialFitmentView(fitmentView(engines(Array(27).fill(5))), rest);
  assert.ok(long.groups.every(group => group.rows.length === 0 && group.count === 5));
  assert.equal(long.models?.length, 27);
  assert.ok(JSON.stringify(long).length < 2048, `${JSON.stringify(long).length} bytes`);
  assert.ok(!JSON.stringify(long).includes("ENG"));
  // A linked model keeps its href.
  const linked = initialFitmentView(fitmentView(engines([30], () => ({ modelHref: "/yedek-parca/volkswagen/model-1" }))), rest);
  assert.deepEqual(linked.groups, [{ make: "VOLKSWAGEN", model: "Volkswagen Model 1", href: "/yedek-parca/volkswagen/model-1", rows: [], count: 30 }]);
});

test("initialFitmentView keeps a garage vehicle's short first group whole on a held-back page", () => {
  const full = fitmentView(engines([24, 10, 10]));
  const kept = initialFitmentView(full, rest, true);
  assert.equal(kept.groups[0], full.groups[0]);
  assert.equal(kept.groups[0].rows.length, 24);
  assert.deepEqual(kept.groups.slice(1).map(group => group.count), [10, 10]);
  assert.equal(initialFitmentView(full, rest).groups[0].count, 24);
  const long = initialFitmentView(fitmentView(engines([25, 10])), rest, true);
  assert.deepEqual(long.groups.map(group => [group.rows.length, group.count]), [[0, 25], [0, 10]]);
});

test("visibleFitmentGroups reads held-back groups by make, model and model name until the list merges", () => {
  const sources = engines([10, 10]);
  sources.push(...Array.from({ length: 10 }, (_, row) => vehicle("Audi A3 (8V1)", { makeKey: "AUDI", makeLabel: "Audi", modelId: 100, engineAndCodes: `CZCA-${row + 1}` })));
  const full = fitmentView(sources), view = initialFitmentView(full, rest);
  const plain = visibleFitmentGroups(view, none);
  assert.equal(plain.groups.length, 3);
  assert.equal(plain.hidden, 0);
  const audi = visibleFitmentGroups(view, { ...none, make: "AUDI" });
  assert.deepEqual(audi.groups.map(group => group.model), ["Audi A3 (8V1)"]);
  assert.equal(audi.matches, 10);
  assert.equal(visibleFitmentGroups(view, { ...none, model: "Volkswagen Model 2" }).matches, 10);
  const byName = visibleFitmentGroups(view, { ...none, query: "a3" });
  assert.deepEqual(byName.groups.map(group => group.model), ["Audi A3 (8V1)"]);
  assert.equal(byName.matches, 10);
  // An engine code is in the rows only: no match until they arrive, then the matching rows.
  assert.equal(visibleFitmentGroups(view, { ...none, query: "czca-3" }).matches, 0);
  const merged = { ...view, groups: mergeFitmentGroups(view.groups, full.groups), rest: undefined };
  const code = visibleFitmentGroups(merged, { ...none, query: "czca-3" });
  assert.deepEqual(code.groups.map(group => group.model), ["Audi A3 (8V1)"]);
  assert.equal(code.matches, 1);
});

test("mergeFitmentGroups swaps held-back groups for the loaded ones in place and appends the rest once", () => {
  const sources = engines(Array(9).fill(5));
  sources.push(vehicle("Audi A3 (8V1)", { makeKey: "AUDI", makeLabel: "Audi", vehicleTypeId: 77, modelId: 100 }));
  const canonical = fitmentView(sources).groups;
  const printed = initialFitmentView(fitmentView(sources, { typeId: "77", modelId: "100", makeLabel: "Audi" }), rest, true).groups;
  // The garage's Audi group (one row) stays whole, the next five ship their counts.
  assert.equal(printed[0].model, "Audi A3 (8V1)");
  assert.equal(printed[0].count, undefined);
  assert.ok(printed.slice(1).every(group => group.count === 5));
  const loaded = structuredClone(canonical);
  const merged = mergeFitmentGroups(printed, loaded);
  assert.equal(merged.length, 10);
  assert.equal(new Set(merged.map(group => group.model)).size, 10);
  assert.equal(merged[0], printed[0]);
  // The garage order stays; each held-back group is the loaded object of its model.
  assert.deepEqual(merged.slice(0, 6).map(group => group.model), printed.map(group => group.model));
  for (const group of merged.slice(1, 6)) assert.equal(group, loaded.find(item => item.model === group.model));
  assert.deepEqual(merged.slice(6).map(group => group.model), ["Volkswagen Model 6", "Volkswagen Model 7", "Volkswagen Model 8", "Volkswagen Model 9"]);
  // A model the loaded list no longer has (a stale version) leaves.
  const without = mergeFitmentGroups(printed, loaded.filter(group => group.model !== "Volkswagen Model 2"));
  assert.equal(without.length, 9);
  assert.ok(!without.some(group => group.model === "Volkswagen Model 2"));
});

test("fitmentRowCount and the load-failure note", () => {
  assert.equal(fitmentRowCount({ make: "VW", model: "Golf", rows: [], count: 12 }), 12);
  assert.equal(fitmentRowCount(fitmentView(engines([3])).groups[0]), 3);
  const held = initialFitmentView(fitmentView(engines([10, 10, 10])), rest);
  const heldLong = initialFitmentView(fitmentView(engines(Array(8).fill(5))), rest);
  const inlineLong = initialFitmentView(fitmentView(series(8)), rest);
  assert.equal(fitmentFailureNote(held, { searching: true, filtering: true }), " Motor seçenekleri yüklenmemiş modellerde yalnız model adında arandı.");
  assert.equal(fitmentFailureNote(heldLong, { searching: true, filtering: true }),
    ` Yalnız ilk ${fitmentInitialGroups} model içinde arandı; motor seçenekleri yüklenmemiş olanlarda yalnız model adında.`);
  // A garage vehicle's group printed with its rows among held-back ones: the note still holds.
  const garaged = initialFitmentView(fitmentView(engines([3, 10, 15])), rest, true);
  assert.deepEqual(garaged.groups.map(group => group.count), [undefined, 10, 15]);
  assert.equal(fitmentFailureNote(garaged, { searching: true, filtering: true }), " Motor seçenekleri yüklenmemiş modellerde yalnız model adında arandı.");
  assert.equal(fitmentFailureNote(inlineLong, { searching: true, filtering: true }), ` Yalnız ilk ${fitmentInitialGroups} model içinde arandı.`);
  assert.equal(fitmentFailureNote(heldLong, { searching: false, filtering: true }), ` Yalnız ilk ${fitmentInitialGroups} model içinde arandı.`);
  // Every group printed and no search, or nothing filtered: nothing to add.
  assert.equal(fitmentFailureNote(held, { searching: false, filtering: true }), "");
  assert.equal(fitmentFailureNote(heldLong, { searching: false, filtering: false }), "");
});

test("productPageFitment holds back three models of ten rows under the route's version, with or without a garage", () => {
  const base = { fuel: "Diesel", ps: 150, kw: 110, cc: 1968, from: "04/2013", to: "03/2017" };
  const vehicles = [1, 2, 3].flatMap(model => Array.from({ length: 10 }, (_, row) => ({ ...base, engineAndCodes: `ENG${model}-${row + 1}`,
    model: `VOLKSWAGEN MODEL ${model}`, catalogBrand: "VOLKSWAGEN", modelId: model, vehicleTypeId: model * 100 + row })));
  const input = { vehicles, makeNames: ["VOLKSWAGEN"], modelFits: new Set([1]), modelPaths: new Map([[1, "/yedek-parca/volkswagen/model-1"]]) };
  const route = productFitmentGroups(input);
  const id = "9db4f695-185e-4d35-b8e4-190bfb549e91";
  const plain = productPageFitment(input, null, id);
  assert.equal(plain?.rest, `/api/product-fitments/${id}?v=${route.v}`);
  assert.deepEqual(plain?.groups.map(group => [group.rows.length, group.count]), [[0, 10], [0, 10], [0, 10]]);
  assert.equal(plain?.groups[0].href, "/yedek-parca/volkswagen/model-1");
  assert.equal("models" in (plain ?? {}), false);
  const garaged = productPageFitment(input, { typeId: "302", modelId: "3", makeLabel: "Volkswagen" }, id);
  assert.equal(garaged?.rest, plain?.rest);
  assert.equal(garaged?.groups[0].model, "Volkswagen Model 3");
  assert.equal(garaged?.groups[0].rows.length, 10);
  assert.equal(garaged?.groups[0].count, undefined);
  assert.deepEqual(garaged?.groups.slice(1).map(group => group.count), [10, 10]);
  assert.equal(mergeFitmentGroups(garaged!.groups, route.groups).length, 3);
  // The model alone puts its group first and keeps its rows too.
  assert.equal(productPageFitment(input, { typeId: null, modelId: "2", makeLabel: "Volkswagen" }, id)?.groups[0].rows.length, 10);
  // A garage vehicle the list does not name (only its make matches, or nothing) keeps no group's rows.
  for (const garage of [{ typeId: "999", modelId: "999", makeLabel: "Volkswagen" }, { typeId: null, modelId: null, makeLabel: "Fiat" }]) {
    const other = productPageFitment(input, garage, id);
    assert.equal(other?.rest, plain?.rest);
    assert.deepEqual(other?.groups.map(group => [group.rows.length, group.count]), [[0, 10], [0, 10], [0, 10]], JSON.stringify(garage));
  }
  // Two models of ten rows stay whole.
  assert.equal(productPageFitment({ ...input, vehicles: vehicles.slice(0, 20) }, null, id)?.rest, undefined);
});
