import assert from "node:assert/strict";
import test from "node:test";
import {displaySpecifications,facetOptions,withSelectedOptions,translateSpecificationLabel,translateSpecificationList,translateSpecificationParts,translateSpecificationValue} from "../src/modules/store/specification-translations";
import {applySpecOverrides,mergeSpecificationRows,pageSpecifications} from "../src/modules/store/product-spec-display";
import {activeFilters,isPanelFilter,clearAllFilters,clearPanelFilters,toggleAttribute,toggleBrand,type CatalogFacet,selectedBrands, selectedAttributes,catalogSpecifications,sameSpecificationText,specificationKey,specificationLabel,specificationRawValue,specificationValue} from "../src/modules/store/catalog-filters";
import {parseCatalogQuery} from "../src/modules/store/catalog-query";
import {listingUrl} from "../src/modules/seo/paths";

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
test("decimal commas are not list commas (#703)", () => {
  for (const value of ["1,1","5,5","M14 x 1,5","114,3","M10x1,25","12,5 mm"]) assert.equal(translateSpecificationList(value), value);
  assert.equal(translateSpecificationList("Front Axle, Rear Axle, 5,5"), "Ön aks, Arka aks, 5,5");
  for (const value of ["1, 1","H7, H7"]) assert.equal(translateSpecificationList(value), value);
  assert.equal(translateSpecificationList("Left and Right"), "Sol ve sağ");
  assert.deepEqual(translateSpecificationParts("and"), ["and"]);
  assert.equal(facetOptions(["1,5","5,1"]).length, 2);
  assert.deepEqual(facetOptions([","]), [{label:",",values:[","]}]);
});
test("frequent English facet values are Turkish (#703)", () => {
  assert.equal(translateSpecificationList("Long-life Filter"), "Uzun ömürlü filtre");
  assert.equal(translateSpecificationList("Air Filter Housing, Intake Manifold"), "Hava filtresi gövdesi, Emme manifoldu");
  assert.equal(translateSpecificationList("Mass Air Flow Sensor to throttle body"), "Hava akış sensöründen gaz kelebeğine");
  assert.equal(translateSpecificationList("with sealing cap"), "Sızdırmazlık kapaklı");
  assert.equal(translateSpecificationList("Bracket wiper blade without spoiler"), "Klasik (kollu) silecek, spoilersiz");
  assert.equal(translateSpecificationList("hard version"), "Sert tip");
});

test("the page's own maker, part number and barcode win over the enrichment's rows (#712)", () => {
  const rows:[string,string][]=[["Manufacturer","MAHLE"],["Manufacturer Part Number","X1"],["EAN","123"],["Brand class","Premium"],["Trade numbers","T1"],["Height [mm]","10"]];
  assert.deepEqual(pageSpecifications(rows,true,true),[["Brand class","Premium"],["Trade numbers","T1"],["Height [mm]","10"]]);
  assert.deepEqual(pageSpecifications(rows,true,false),[["EAN","123"],["Brand class","Premium"],["Trade numbers","T1"],["Height [mm]","10"]]);
  assert.deepEqual(pageSpecifications(rows,false,false),[["Height [mm]","10"]]);
});

test("mergeSpecificationRows merges equal labels, keeps every distinct value and drops empty rows (#712)", () => {
  assert.deepEqual(mergeSpecificationRows([["A","Febi"],["B","1 kg"],["A","FEBI"],["A","Febi Bilstein"],["C",""],["D"," "],["D","x"]]),
    [["A","Febi, Febi Bilstein"],["B","1 kg"],["D","x"]]);
  assert.deepEqual(mergeSpecificationRows([["E",""]]),[]);
});

test("card display pairs are translated in the raw order, raw keys stay (#700)", () => {
  const raw:[string,string][]=[["Fitting Position","Front Axle, Rear Axle"],["Outer Diameter [mm]","280,5"],["Thread Size","M14 x 1,5"],["Renk","Siyah"]];
  const display=displaySpecifications(raw);
  assert.deepEqual(display.map(row=>row.key),raw.map(([key])=>key));
  assert.deepEqual(display[0],{key:"Fitting Position",label:"Montaj konumu",value:"Ön aks, Arka aks"});
  assert.deepEqual(display[1],{key:"Outer Diameter [mm]",label:"Dış çap [mm]",value:"280,5"});
  assert.equal(display[2].value,"M14 x 1,5");
  assert.deepEqual(display[3],{key:"Renk",label:"Renk",value:"Siyah"});
  assert.deepEqual(raw[0],["Fitting Position","Front Axle, Rear Axle"]);
});

// #883: the selected filters as removable chips; the sidebar and the phone sheet toggle through the same helpers.
const positionFacet:CatalogFacet={key:"Fitting Position",label:"Montaj konumu",options:[{label:"Ön aks",values:["Front Axle","Vorderachse"]},{label:"Arka aks",values:["Rear Axle"]}]};
test("toggling a manufacturer adds or removes it and moves a legacy brand into the list", () => {
  assert.deepEqual(toggleBrand({brands:'["BOSCH"]'},"FEBI"),{brand:undefined,brands:'["BOSCH","FEBI"]'});
  assert.deepEqual(toggleBrand({brands:'["BOSCH","FEBI"]'},"BOSCH"),{brand:undefined,brands:'["FEBI"]'});
  assert.deepEqual(toggleBrand({brand:"BOSCH"},"BOSCH"),{brand:undefined,brands:undefined});
  assert.deepEqual(toggleBrand({brand:"BOSCH"},"FEBI"),{brand:undefined,brands:'["BOSCH","FEBI"]'});
});
test("toggling a merged option adds or removes all of its spellings", () => {
  assert.deepEqual(toggleAttribute({},"Fitting Position",["Front Axle","Vorderachse"]),{attributes:'{"Fitting Position":["Front Axle","Vorderachse"]}'});
  assert.deepEqual(toggleAttribute({attributes:'{"Fitting Position":["Vorderachse","Rear Axle"]}'},"Fitting Position",["Front Axle","Vorderachse"]),{attributes:'{"Fitting Position":["Rear Axle"]}'});
  assert.deepEqual(toggleAttribute({attributes:'{"Fitting Position":["Front Axle"]}'},"Fitting Position",["Front Axle"]),{attributes:undefined});
});
test("active filters list every selection with the change that removes it", () => {
  const query={brands:'["BOSCH","FEBI"]',attributes:'{"Fitting Position":["Front Axle","Vorderachse","Rear Axle"],"Brand class":["Premium"]}',availability:"supplied" as const,fits:"vehicle" as const,oil:"viscosity,approval"};
  const items=activeFilters(query,[positionFacet]);
  assert.deepEqual(items.map(item=>item.label),["BOSCH","FEBI","Montaj konumu: Ön aks","Montaj konumu: Arka aks","Marka sınıfı: Premium","Tedarik edilebilir","Aracına uyanlar","Önerilen viskozite","Önerilen yağ onayı"]);
  assert.deepEqual(items[0].remove,{brand:undefined,brands:'["FEBI"]'});
  // A merged option is one chip; removing it drops both spellings and keeps the other option.
  assert.deepEqual(items[2].remove,{attributes:'{"Fitting Position":["Rear Axle"],"Brand class":["Premium"]}'});
  // A value without a facet (no products left under the other filters) still gets a chip.
  assert.deepEqual(items[4].remove,{attributes:'{"Fitting Position":["Front Axle","Vorderachse","Rear Axle"]}'});
  assert.deepEqual(items[5].remove,{availability:undefined});
  assert.deepEqual(items[6].remove,{fits:undefined});
  assert.deepEqual(items[7].remove,{oil:"approval"});
  assert.equal(new Set(items.map(item=>item.key)).size,items.length);
});
test("a legacy single brand and other stock states show as chips", () => {
  const items=activeFilters({brand:"BOSCH",availability:"in_stock"},[]);
  assert.deepEqual(items.map(item=>[item.label,item.remove]),[["BOSCH",{brand:undefined,brands:undefined}],["Stokta mevcut",{availability:undefined}]]);
  assert.deepEqual(activeFilters({availability:"out_of_stock"},[]).map(item=>item.label),["Stokta yok"]);
  assert.deepEqual(activeFilters({},[positionFacet]),[]);
});
test("removing a chip keeps the sort and the path, and starts on page 1", () => {
  const query={category:"fren-diskleri-269",make:"volkswagen",brands:'["BOSCH","FEBI"]',availability:"in_stock" as const,sort:"price-asc" as const,page:"3"};
  const [bosch]=activeFilters(query,[]);
  assert.equal(listingUrl(query,bosch.remove),"/kategori/fren-diskleri-269/volkswagen?brands=%5B%22FEBI%22%5D&availability=in_stock&sort=price-asc");
  assert.equal(listingUrl({...query,fits:"vehicle",oil:"viscosity"},clearAllFilters),"/kategori/fren-diskleri-269/volkswagen?sort=price-asc");
  // The panel's "Temizle" clears only its own groups; the vehicle-fit and engine-oil filters come off from their chips.
  assert.equal(listingUrl({...query,fits:"vehicle"},clearPanelFilters),"/kategori/fren-diskleri-269/volkswagen?sort=price-asc&fits=vehicle");
});
test("the vehicle-fit chip names the garage vehicle; only manufacturer, option and stock chips are the panel's", () => {
  const items=activeFilters({brand:"BOSCH",fits:"vehicle",oil:"viscosity"},[],{vehicleName:"Volkswagen Golf 1.6 TDI"});
  assert.deepEqual(items.map(item=>item.label),["BOSCH","Aracına uyanlar: Volkswagen Golf 1.6 TDI","Önerilen viskozite"]);
  assert.deepEqual(items.map(isPanelFilter),[true,false,false]);
});
test("selected values the facets no longer offer get one chip per sidebar translation", () => {
  const attributes={"Fitting Position":["Rear Axle","Front Axle","front axle"],"Surface":["Coated"]};
  const facets=withSelectedOptions([{key:"Fitting Position",label:"Montaj konumu",options:[{label:"Arka aks",values:["Rear Axle"]}]}],attributes);
  const items=activeFilters({attributes:JSON.stringify(attributes)},facets);
  assert.deepEqual(items.map(item=>item.label),["Montaj konumu: Arka aks","Montaj konumu: Ön aks","Yüzey: Kaplamalı"]);
  // One chip removes every spelling of the value.
  assert.deepEqual(items[1].remove,{attributes:'{"Fitting Position":["Rear Axle"],"Surface":["Coated"]}'});
  // Without the server's grouping, values that read the same still share a chip.
  const fallback=activeFilters({attributes:JSON.stringify(attributes)},[]);
  assert.deepEqual(fallback.map(item=>item.label),["Montaj konumu: Arka aks","Montaj konumu: Ön aks","Montaj konumu: front axle","Yüzey: Kaplamalı"]);
  assert.deepEqual(withSelectedOptions([],{}),[]);
});
