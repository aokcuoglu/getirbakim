import assert from "node:assert/strict";
import test from "node:test";
import {facetOptions,translateSpecificationLabel,translateSpecificationList,translateSpecificationParts,translateSpecificationValue} from "../src/modules/store/specification-translations";
import {applySpecOverrides} from "../src/modules/store/product-spec-display";
import {selectedBrands, selectedAttributes,catalogSpecifications,sameSpecificationText,specificationKey,specificationLabel,specificationRawValue,specificationValue} from "../src/modules/store/catalog-filters";
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
  assert.equal(specificationKey("FITTING POSITION"), "Fitting Position");
  assert.equal(specificationKey("BRAND CLASS"), "Brand class");
  assert.equal(specificationKey("İŞLEME"), "Processing");
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
  assert.ok(sameSpecificationText(" FILTER TYPE", "Filter type") && !sameSpecificationText("Filter", "Filter type"));
  assert.equal(specificationValue("toString"), "toString");
});

test("product page rows are translated after overrides, admin text stays as written (#622)", () => {
  const enrichment:[string,string][]=[["Brake Disc Type","Vented"],["Fitting Position","Front Axle"],["Outer Diameter [mm]","280"],["Thickness [mm]","25"],["Number of mounting bores","5"],["Surface","Coated"]];
  const shown=applySpecOverrides(enrichment,[{action:"set",key:"Surface",value:"Özel kaplama"},{action:"set",key:"Renk",value:"Siyah"}]).map(([k,v])=>[translateSpecificationLabel(k),translateSpecificationValue(v)]);
  assert.deepEqual(shown,[["Fren diski tipi","Havalandırmalı"],["Montaj konumu","Ön aks"],["Dış çap [mm]","280"],["Kalınlık [mm]","25"],["Montaj deliği sayısı","5"],["Yüzey","Özel kaplama"],["Renk","Siyah"]]);
});

test("one entry covers a key with and without unit and index suffix (#622)", () => {
  assert.equal(translateSpecificationLabel("Outer Diameter"), "Dış çap");
  assert.equal(translateSpecificationLabel("Outer Diameter [mm]"), "Dış çap [mm]");
  assert.equal(translateSpecificationLabel("Inner Diameter 2 [mm]"), "İç çap 2 [mm]");
  assert.equal(translateSpecificationLabel("Packaging height [cm]"), "Ambalaj yüksekliği [cm]");
  assert.equal(translateSpecificationLabel("Thickness [mm]"), "Kalınlık [mm]");
  assert.equal(translateSpecificationLabel("Minimum thickness"), "Minimum kalınlık");
  assert.equal(translateSpecificationLabel("Montaj tarafı"), "Montaj tarafı");
  assert.equal(translateSpecificationLabel("Unknown Thing [mm]"), "Unknown Thing [mm]");
  assert.equal(translateSpecificationLabel("constructor"), "constructor");
  assert.equal(translateSpecificationLabel("EAN"), "EAN");
});

test("free-text values translate whole and by with/without phrase (#622)", () => {
  assert.equal(translateSpecificationValue("painted"), "Boyalı");
  assert.equal(translateSpecificationValue("Coated"), "Kaplamalı");
  assert.equal(translateSpecificationValue("vented"), "Havalandırmalı");
  assert.equal(translateSpecificationValue("with gaskets/seals"), "conta/keçe dahil");
  assert.equal(translateSpecificationValue("without bulb holder, without bulb"), "ampul yuvası, ampul hariç");
  assert.equal(translateSpecificationValue("with something unknown"), "with something unknown");
  assert.equal(translateSpecificationValue("DEPO"), "DEPO");
  assert.equal(translateSpecificationValue("toString"), "toString");
});

test("comma separated and position values translate part by part (#703)", () => {
  assert.deepEqual(translateSpecificationParts("Right, Left, Rear Axle"), ["Sağ","Sol","Arka aks"]);
  assert.deepEqual(translateSpecificationParts("Lower Front Axle"), ["Alt ön aks"]);
  assert.deepEqual(translateSpecificationParts("Right Front"), ["Sağ ön"]);
  assert.deepEqual(translateSpecificationParts("Front Axle both sides"), ["Ön aks her iki taraf"]);
  assert.deepEqual(translateSpecificationParts("Left and right"), ["Sol ve sağ"]);
  assert.deepEqual(translateSpecificationParts("Left Exterior Mirror"), ["Left Exterior Mirror"]);
  assert.equal(translateSpecificationList("without bulb holder, without bulb"), "ampul yuvası, ampul hariç");
  assert.equal(translateSpecificationList("Front Axle, Rear Axle"), "Ön aks, Arka aks");
  assert.equal(translateSpecificationList("toString"), "toString");
  assert.equal(translateSpecificationValue("6-Speed manual transmission"), "6 ileri manuel şanzıman");
  assert.equal(translateSpecificationValue("D2S (gas discharge lamp)"), "D2S (xenon)");
});
test("facet options merge equivalent raw values and keep each exactly once (#703)", () => {
  const raw=["Front Axle","Front Axle, Rear Axle","Ön aks","Rear Axle, Front Axle","Rear Axle, Rear Axle Left","outer","Outer","INLET","Inlet","toString","constructor"];
  const options=facetOptions(raw);
  const byLabel=(label:string)=>options.find(o=>o.label===label)?.values.sort();
  assert.deepEqual(byLabel("Ön aks"),["Front Axle","Ön aks"]);
  assert.deepEqual(byLabel("Ön aks, Arka aks"),["Front Axle, Rear Axle","Rear Axle, Front Axle"]);
  assert.deepEqual(byLabel("Arka aks, Arka aks sol"),["Rear Axle, Rear Axle Left"]);
  assert.deepEqual(byLabel("Dış"),["Outer","outer"]);
  assert.deepEqual(byLabel("Giriş"),["INLET","Inlet"]);
  assert.deepEqual(byLabel("toString"),["toString"]);
  assert.deepEqual(options.flatMap(o=>o.values).sort(),[...raw].sort());
  const labels=options.map(o=>o.label);
  assert.deepEqual(labels,[...labels].sort((a,b)=>a.localeCompare(b,"tr")));
});
test("an attribute group holds up to 40 values (#703)", () => {
  const group=(n:number)=>JSON.stringify({"Fitting Position":Array.from({length:n},(_,i)=>"v"+i)});
  assert.equal(selectedAttributes({attributes:group(40)})["Fitting Position"].length,40);
  assert.deepEqual(selectedAttributes({attributes:group(41)}),{});
});
