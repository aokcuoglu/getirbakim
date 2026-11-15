import assert from "node:assert/strict";
import test from "node:test";
import {selectedBrands, selectedAttributes,catalogSpecifications,specificationKey,specificationLabel,specificationRawValue,specificationValue} from "../src/modules/store/catalog-filters";
import {parseCatalogQuery} from "../src/modules/store/catalog-query";

test("manufacturer selection supports multiple brands and legacy links", () => {
  assert.deepEqual(selectedBrands({brand:"BOSCH"}), ["BOSCH"]);
  assert.deepEqual(selectedBrands({brand:"FEBI", brands:'["BOSCH","FEBI"]'}), ["BOSCH","FEBI"]);
});
test("malformed and oversized filter groups are rejected", () => {
  for (const brands of ['{', '"BOSCH"', '[null]', JSON.stringify(Array(31).fill("BOSCH"))]) {
    assert.deepEqual(selectedBrands({brands}), []);
  }
  for (const attributes of ['{', '["Front Axle"]', '{"Fitting Position":[null]}', JSON.stringify(Object.fromEntries(Array.from({length:9}, (_,i) => [String(i),["x"]])))]) {
    assert.deepEqual(selectedAttributes({attributes}), {});
  }
});
test("attribute values preserve source keys while trimming selections", () => {
  assert.deepEqual(selectedAttributes({attributes:'{"Fitting Position":[" Front Axle ","Rear Axle"],"Brand class":["Premium"]}'}), {"Fitting Position":["Front Axle","Rear Axle"],"Brand class":["Premium"]});
});
test("stock filter accepts 'supplied' (Tedarik edilebilir, #475)", () => {
  assert.equal(parseCatalogQuery({availability:"supplied"}).availability,"supplied");
});
test("unsupported stock states and excessive request input are ignored", () => {
  const query=parseCatalogQuery({availability:"unknown",brands:"x".repeat(6501),attributes:"x".repeat(18001)});
  assert.equal(query.availability,undefined);
  assert.equal(query.brands,undefined);
  assert.equal(query.attributes,undefined);
});
test("OEM alternatives keep technical criteria without adopting another part's identity", () => {
 const specs:[string,string][]=[["Fitting Position","Front Axle"],["Brand class","Premium"],["EAN","123"],["Manufacturer","ABE"],["Manufacturer Part Number","C2S000ABE"]];
 assert.deepEqual(catalogSpecifications(specs,false),[["Fitting Position","Front Axle"]]);
 assert.deepEqual(catalogSpecifications(specs,true),specs);
});
test("typed specification keys and values map back to the source spelling (#603)", () => {
  assert.equal(specificationKey("Montaj konumu"), "Fitting Position");
  assert.equal(specificationKey(" MONTAJ KONUMU "), "Fitting Position");
  assert.equal(specificationKey("fitting position"), "Fitting Position");
  assert.equal(specificationKey("Üretici"), "Manufacturer");
  assert.equal(specificationKey("Renk "), "Renk");
  assert.equal(specificationKey("constructor"), "constructor");
  assert.equal(specificationRawValue("Fitting Position", "Ön aks"), "Front Axle");
  assert.equal(specificationRawValue("Fitting Position", "front axle"), "Front Axle");
  assert.equal(specificationRawValue("Brake Disc Type", "Havalandırmalı"), "Vented");
  assert.equal(specificationRawValue("Brake Disc Type", "vented"), "vented");
  assert.equal(specificationRawValue("Renk", "Ön"), "Ön");
  assert.equal(specificationRawValue("Fitting Position", " Üst sol "), "Üst sol");
  assert.equal(specificationLabel("constructor"), "constructor");
  assert.equal(specificationValue("toString"), "toString");
});
