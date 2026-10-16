import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptedLicense, classifyMatch, plainAuthor, vehicleModelImageAttribution, vehicleModelImageQueries, wikidataBrandName } from "../src/modules/store/vehicle-model-images";

test("TecDoc series names become ordered Wikidata queries, generation first", () => {
  const clio = vehicleModelImageQueries("RENAULT", "CLIO V (B7_)");
  assert.deepEqual(clio.queries.slice(0, 3), ["Renault Clio V", "Renault Clio Mk5", "Renault Clio 5"]);
  assert.ok(clio.queries.includes("Renault Clio B7") && clio.queries.includes("Renault B7"));
  assert.equal(clio.queries.at(-1), "Renault Clio");
  assert.equal(clio.family, "Clio");
  assert.equal(clio.generationMarker, true);

  const golf = vehicleModelImageQueries("VOLKSWAGEN", "GOLF VII (5G1, BQ1, BE1, BE2)");
  assert.equal(golf.queries[0], "Volkswagen Golf VII");
  assert.ok(golf.queries.includes("Volkswagen Golf Mk7"));

  // Body words and chassis codes fall away; a letter generation ("Astra K") is kept as the generation.
  const astra = vehicleModelImageQueries("OPEL", "ASTRA K Sports Tourer (B16)");
  assert.equal(astra.queries[0], "Opel Astra K");
  assert.equal(astra.family, "Astra");
  const corolla = vehicleModelImageQueries("TOYOTA", "COROLLA Saloon (_E21_)");
  assert.deepEqual(corolla.queries, ["Toyota Corolla E21", "Toyota E21", "Toyota Corolla"]);
  assert.equal(corolla.generationMarker, true);

  // A plain name with no generation marker is a single query and needs no generation disambiguation.
  const austral = vehicleModelImageQueries("RENAULT", "AUSTRAL");
  assert.deepEqual(austral.queries, ["Renault Austral"]);
  assert.equal(austral.generationMarker, false);
  // Letter-only chassis codes still mark a generation ("CX-5 (KE, GH)") but never search on their own.
  const cx5 = vehicleModelImageQueries("MAZDA", "CX-5 (KE, GH)");
  assert.equal(cx5.generationMarker, true);
  assert.ok(!cx5.queries.includes("Mazda KE"));
});

test("brand spellings follow Wikidata labels", () => {
  assert.equal(wikidataBrandName("VW"), "Volkswagen");
  assert.equal(wikidataBrandName("MERCEDES-BENZ"), "Mercedes-Benz");
  assert.equal(wikidataBrandName("ALFA ROMEO"), "Alfa Romeo");
  assert.equal(wikidataBrandName("CITROËN"), "Citroën");
  assert.equal(wikidataBrandName("BMW"), "BMW");
  assert.equal(wikidataBrandName("HYUNDAI"), "Hyundai");
});

test("only free licences are accepted", () => {
  for (const ok of ["CC BY-SA 4.0", "CC BY 2.0", "CC BY-SA 3.0 de", "CC0", "CC0 1.0", "Public domain", "PD-self"]) assert.ok(acceptedLicense(ok), ok);
  for (const bad of ["CC BY-NC-SA 4.0", "CC BY-ND 4.0", "GPL", "GFDL", "", null, undefined, "Fair use"]) assert.ok(!acceptedLicense(bad), String(bad));
});

test("a family item on a multi-generation series needs review; a generation item does not", () => {
  const clio = { family: "Clio", generationMarker: true };
  assert.equal(classifyMatch({ label: "Renault Clio V", partOfSeries: true }, clio), "generation");
  assert.equal(classifyMatch({ label: "Renault Clio", description: "supermini car", partOfSeries: false }, clio), "family");
  assert.equal(classifyMatch({ label: "Volkswagen Golf Mk7", partOfSeries: false }, { family: "Golf", generationMarker: true }), "generation");
  assert.equal(classifyMatch({ label: "Ford Kuga (second generation)", partOfSeries: false }, { family: "Kuga", generationMarker: true }), "generation");
  assert.equal(classifyMatch({ label: "Toyota Corolla (E210)", partOfSeries: false }, { family: "Corolla", generationMarker: true }), "generation");
  assert.equal(classifyMatch({ label: "Opel Astra K", partOfSeries: false }, { family: "Astra", generationMarker: true }), "generation");
  // The family name may look like a chassis code itself.
  assert.equal(classifyMatch({ label: "Volvo S60", partOfSeries: false }, { family: "S60", generationMarker: true }), "family");
  assert.equal(classifyMatch({ label: "Hyundai i20", partOfSeries: false }, { family: "I20", generationMarker: true }), "family");
  // No generation marker in the TecDoc name: the model item is the series.
  assert.equal(classifyMatch({ label: "Renault Austral", partOfSeries: false }, { family: "Austral", generationMarker: false }), "generation");
});

test("attribution is plain text with author and licence", () => {
  assert.equal(plainAuthor('<a href="//commons.wikimedia.org/wiki/User:Vauxford" title="User:Vauxford">Vauxford</a>'), "Vauxford");
  assert.equal(plainAuthor("  "), null);
  assert.equal(plainAuthor("x".repeat(200))?.length, 118);
  assert.equal(vehicleModelImageAttribution({ author: "Vauxford", license: "CC BY-SA 4.0" }), "Foto: Vauxford · CC BY-SA 4.0");
  assert.equal(vehicleModelImageAttribution({ author: null, license: "CC0" }), "Foto: Wikimedia Commons · CC0");
});
