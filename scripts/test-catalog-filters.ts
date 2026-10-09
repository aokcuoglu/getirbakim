import assert from "node:assert/strict";
import test from "node:test";
import {selectedBrands, selectedAttributes,catalogSpecifications} from "../src/modules/store/catalog-filters";
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
