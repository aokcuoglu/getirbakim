import test from "node:test";
import assert from "node:assert/strict";
import { createDescriptionMatcher, descriptionYears, type DescriptionCatalogModel } from "../src/modules/store/description-fitment";

let id = 0;
const model = (brand: string, name: string, from: number | null, to: number | null): DescriptionCatalogModel => ({ id: ++id, brand, name, from, to });
const catalog = [
  model("VW", "SCIROCCO (53B)", 1980, 1992), model("VW", "SCIROCCO III (137, 138)", 2008, 2018),
  model("VW", "GOLF VI (5K1)", 2008, 2013), model("VW", "GOLF VII (5G1, BQ1, BE1, BE2)", 2012, 2020), model("VW", "GOLF III (1H1)", 1991, 1998),
  model("VW", "POLO V (6R1, 6C1)", 2009, null), model("VW", "POLO VI (AW1, BZ1, AE1)", 2017, null),
  model("RENAULT", "MEGANE III Hatchback (BZ0/1_, B3_)", 2008, null), model("RENAULT", "MEGANE IV Hatchback (B9A/M/N_)", 2015, null),
  model("RENAULT", "CLIO III (BR0/1, CR0/1)", 2005, 2014), model("RENAULT", "CLIO IV (BH_)", 2012, null),
  model("RENAULT", "KANGOO III", 2021, null), model("RENAULT", "SCÉNIC II (JM0/1_)", 2003, 2009), model("RENAULT", "GRAND SCÉNIC II (JM0/1_)", 2004, 2009),
  model("BMW", "X1 (E84)", 2009, 2015), model("BMW", "4 Coupe (F32, F82)", 2013, 2020), model("BMW", "4 Gran Coupe (F36)", 2014, 2021),
  model("MERCEDES-BENZ", "C-CLASS (W205)", 2013, 2023),
  model("FORD", "ESCORT I (AFH, ATH)", 1967, 1975), model("FORD", "ESCORT VII (GAL, AAL, ABL)", 1995, 2000),
  model("FORD", "MONDEO I (GBP)", 1993, 1996), model("FORD", "MONDEO IV (BA7)", 2007, 2015),
  model("PEUGEOT", "105", 1985, 1990), model("PEUGEOT", "206 Hatchback (2A/C)", 1998, 2012),
  model("CITROEN", "C4 I (LC_)", 2004, 2011), model("CITROEN", "GRAND C4 SPACETOURER (3A_, 3E_)", 2018, null),
  model("AUDI", "A4 B9 (8W2, 8WC)", 2015, null), model("AUDI", "A4 B8 (8K2)", 2007, 2015),
];
const match = createDescriptionMatcher(catalog, 2026);
const names = (make: string, text: string) => match(make, text).modelIds.map(found => catalog.find(m => m.id === found)!.name);

test("years pick the generation the part was made for", () => {
  assert.deepEqual(names("VAG", "STOP LAMBASI ARKA SOL SCIROCCO 2008>2015"), ["SCIROCCO III (137, 138)"]);
  assert.deepEqual(names("VAG", "SIS FARI SOL LED+HOLOJEN POLO 18>"), ["POLO VI (AW1, BZ1, AE1)"]);
  assert.deepEqual(names("VAG", "FAR ON SOL A4 2016>"), ["A4 B9 (8W2, 8WC)"]);
  assert.deepEqual(match("VAG", "STOP LAMBASI SCIROCCO 2008>2015").models[0], { id: catalog[1].id, yearFrom: 2008, yearTo: 2015 });
});
test("chassis codes identify the model directly, across body styles", () => {
  assert.deepEqual(names("BMW", "FAR KASASI F32 LCI F36 LCI SOL LED 16>20"), ["4 Coupe (F32, F82)", "4 Gran Coupe (F36)"]);
  assert.deepEqual(names("MERCEDES", "CAMURLUK DAVLUMBAZ C CLASS W205 14>"), ["C-CLASS (W205)"]);
  assert.deepEqual(names("BMW", "TAMPON IZGARASI X1 E84 ON 09>15"), ["X1 (E84)"]);
});
test("generations written after the family narrow it, engine sizes do not", () => {
  assert.deepEqual(names("RENAULT", "AMORTISOR ARKA MEGANE 4 2016>2020"), ["MEGANE IV Hatchback (B9A/M/N_)"]);
  assert.deepEqual(names("RENAULT", "SU FISKIYE MEMESI CLIO IV KANGOO III"), ["CLIO IV (BH_)", "KANGOO III"]);
  assert.deepEqual(names("VAG", "CEK VALFI GOLF VI VII"), ["GOLF VI (5K1)", "GOLF VII (5G1, BQ1, BE1, BE2)"]);
  assert.deepEqual(names("FORD", "KAYIS MONDEO IV 1.6TI 10>"), ["MONDEO IV (BA7)"]);
});
test("a family inside a longer one is the longer one", () => {
  assert.deepEqual(names("RENAULT", "ARKA LAMBA GRAND SCENIC II 05>"), ["GRAND SCÉNIC II (JM0/1_)"]);
  assert.deepEqual(names("PSA", "CAMURLUK DAVLUMBAZI ON SOL C4 04>"), ["C4 I (LC_)"]);
});
test("a family without years or generation is kept only when it is short-lived", () => {
  assert.equal(match("FORD", "ON CAM ACMA KUMANDA ANAHTARI ESCORT 8 PIN").status, "ambiguous");
  assert.deepEqual(names("VAG", "SILECEK KOLU SCIROCCO III"), ["SCIROCCO III (137, 138)"]);
});
test("numbers are models only beside their make, never in measurements", () => {
  assert.equal(match("PSA", "SUBAP (33 * 105,2) TAKIMI").status, "no_model");
  assert.deepEqual(names("PSA", "ON BALATA P206 1,4"), ["206 Hatchback (2A/C)"]);
  assert.equal(match("RENAULT TRUCK", "BALATA SENSORU PREMIUM 440 / VOLVO").status, "no_brand");
});
test("year ranges read two- and four-digit years", () => {
  assert.deepEqual(descriptionYears("FAR 16>20"), [2016, 2020]);
  assert.deepEqual(descriptionYears("TAKOZ (91>95)"), [1991, 1995]);
  assert.deepEqual(descriptionYears("PANEL 2009>"), [2009, null]);
  assert.equal(descriptionYears("HORTUM 1.6 16V"), null);
});
