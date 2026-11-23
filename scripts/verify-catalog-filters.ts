/**
 * Manual check, not part of CI (#1336): it reads the live data of the local database (.env.local) and picks its fixture
 * category from whatever is imported there, so a CI database (empty or seeded) has nothing to verify and the outcome would
 * change with every import. The CI-safe coverage of the same rules lives in the isolated-schema tests
 * (`npm run test:catalog-filters`, `npm run test:unavailable`). Read-only; run it with a read-only session:
 *   PGOPTIONS="-c default_transaction_read_only=on" node --env-file=.env.local --conditions=react-server \
 *     --experimental-test-module-mocks --import tsx scripts/verify-catalog-filters.ts
 * (a failed listing-cache write is logged and ignored in a read-only session).
 */
import assert from "node:assert/strict";
import {mock} from "node:test";

// getStoreCategories calls next/server's connection(), which throws outside a request; the script is not one.
mock.module("next/server",{namedExports:{connection:async()=>{}}});
const {browseProducts,catalogFacets}=await import("../src/modules/store/catalog");
const {getStoreCategories}=await import("../src/modules/store/categories");
const {getCatalogProductDetails}=await import("../src/modules/store/product-enrichment");
const {db}=await import("../src/lib/db");

const minProducts=6,qualifying=5;
// Fixture: the smallest leaf category, among the first few qualifying ones in category order, whose products fit one
// page and that offers at least two brands and two attribute facets (a brand OR and an attribute AND need that much).
async function pickFixture(){
  const categories=await getStoreCategories();
  const parents=new Set(categories.map(c=>c.parentId));
  const found:{category:string;total:number}[]=[];
  for(const leaf of categories.filter(c=>!parents.has(c.id))){
    const page=await browseProducts({category:leaf.slug});
    if(page.total<minProducts||page.total>page.pageSize)continue;
    const facets=await catalogFacets({category:leaf.slug});
    if(facets.brands.length>=2&&facets.attributes.length>=2)found.push({category:leaf.slug,total:page.total});
    if(found.length>=qualifying)break;
  }
  assert.ok(found.length>0,`No leaf category with ${minProducts}..one page of products, 2 brands and 2 attribute facets`);
  return found.sort((a,b)=>a.total-b.total)[0].category;
}

try {
  const category=await pickFixture();
  const base=await browseProducts({category});
  assert.ok(base.total>0 && base.total<=base.pageSize,"Fixture category must fit in one page");
  const details=await getCatalogProductDetails(base.items);
  assert.equal((await getCatalogProductDetails(base.items.map(p=>({...p,code:"STALE-CODE"})))).size,0,"Stale identity must not supply card specifications");
  const facets=await catalogFacets({category});
  assert.ok(!facets.attributes.some(f=>f.key==="EAN"),"Identifiers must not become facets");
  const brands=facets.brands.slice(0,2);
  assert.equal(brands.length,2);
  const attributes=Object.fromEntries(facets.attributes.slice(0,2).map(f=>[f.key,f.options[0].values]));
  const filtered=await browseProducts({category,brands:JSON.stringify(brands),attributes:JSON.stringify(attributes)});
  const expected=base.items.filter(item=>brands.includes(item.brand)&&Object.entries(attributes).every(([key,values])=>details.get(item.id)?.specifications.some(([k,v])=>k===key&&values.includes(v))));
  assert.deepEqual(filtered.items.map(p=>p.id).sort(),expected.map(p=>p.id).sort(),"Values within a facet use OR; separate facets use AND");
  assert.deepEqual(await catalogFacets({category,brands:JSON.stringify(brands),attributes:JSON.stringify(attributes)}),facets,"Selected filters must not erase available options");
  for(const availability of ["in_stock","out_of_stock","supplied"] as const){
    const stock=await browseProducts({category,availability});
    // Supplied (#475): everything except the products no supplier sells now.
    const expectedStock=base.items.filter(p=>availability==="supplied"?!p.unavailable:availability==="in_stock"?p.available:!p.available&&p.stock_label==="Stokta yok");
    assert.deepEqual(stock.items.map(p=>p.id).sort(),expectedStock.map(p=>p.id).sort(),"Unknown stock is neither in stock nor out of stock");
    // Known failure (#1336): a card whose own row has no stock but whose grouped offer has (card available=true) also
    // lands in out_of_stock, because that filter reads each row alone while in_stock groups offers.
  }
  assert.equal((await browseProducts({category,attributes:JSON.stringify({[Object.keys(attributes)[0]]:["NONEXISTENT"]})})).total,0);
  console.log(`Catalog facets verified in ${category}: ${base.total} products, manufacturer OR, attribute AND, contextual facets and known-stock filters.`);
} finally {await db.end();}
