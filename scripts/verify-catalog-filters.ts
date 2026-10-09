import assert from "node:assert/strict";
import {browseProducts,catalogFacets} from "../src/modules/store/catalog";
import {getCatalogProductDetails} from "../src/modules/store/product-enrichment";
import {db} from "../src/lib/db";

// Read-only verification using imported brake-disc data; no commerce data is changed.
try {
  const category="fren-diskleri-269";
  const base=await browseProducts({category});
  assert.ok(base.total>0 && base.total<=base.pageSize,"Fixture category must fit in one page");
  const details=await getCatalogProductDetails(base.items);
  assert.equal((await getCatalogProductDetails(base.items.map(p=>({...p,code:"STALE-CODE"})))).size,0,"Stale identity must not supply card specifications");
  const facets=await catalogFacets({category});
  const fitting=facets.attributes.find(f=>f.key==="Fitting Position");
  assert.ok(fitting?.values.includes("Front Axle"));
  assert.ok(!facets.attributes.some(f=>f.key==="EAN"),"Identifiers must not become facets");
  const brands=facets.brands.slice(0,2);
  assert.equal(brands.length,2);
  const attributes={"Fitting Position":["Front Axle"],"Brand class":["Premium"]};
  const filtered=await browseProducts({category,brands:JSON.stringify(brands),attributes:JSON.stringify(attributes)});
  const expected=base.items.filter(item=>brands.includes(item.brand)&&Object.entries(attributes).every(([key,values])=>details.get(item.id)?.specifications.some(([k,v])=>k===key&&values.includes(v))));
  assert.deepEqual(filtered.items.map(p=>p.id).sort(),expected.map(p=>p.id).sort(),"Values within a facet use OR; separate facets use AND");
  assert.deepEqual(await catalogFacets({category,brands:JSON.stringify(brands),attributes:JSON.stringify(attributes)}),facets,"Selected filters must not erase available options");
  for(const availability of ["in_stock","out_of_stock"] as const){
    const stock=await browseProducts({category,availability});
    const expectedStock=base.items.filter(p=>availability==="in_stock"?p.available:!p.available&&p.stock_label==="Stokta yok");
    assert.deepEqual(stock.items.map(p=>p.id).sort(),expectedStock.map(p=>p.id).sort(),"Unknown stock is neither in stock nor out of stock");
  }
  assert.equal((await browseProducts({category,attributes:'{"Fitting Position":["NONEXISTENT"]}'})).total,0);
  console.log(`Catalog facets verified: ${base.total} products, manufacturer OR, attribute AND, contextual facets and known-stock filters.`);
} finally {await db.end();}
