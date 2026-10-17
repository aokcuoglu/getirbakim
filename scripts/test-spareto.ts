import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildData,identify,parseProductPage,parseSearch,partQuery,searchPath} from '../src/modules/enrichment/spareto-adapter';
import {enrichmentImportSchema,matchesEnrichment} from '../src/modules/store/enrichment-contract';

const fixture=(name:string)=>readFile(`tests/fixtures/${name}`,'utf8');

test('search cards name the manufacturer and part number; broken cards are skipped',async()=>{
 assert.deepEqual(parseSearch(await fixture('spareto-search.html')),[
  {partNumber:'1.16046',brand:'DT SPARE PARTS',path:'/products/dt-shaft-seal-differential/1-16046'},
  {partNumber:'18796',brand:'FEBI BILSTEIN',path:'/products/febi-bilstein-shaft-seal/18796'}]);
 assert.equal(searchPath('82018654'),'/products?utf8=%E2%9C%93&keywords=82018654');
});

test('product pages keep part properties and split OE from cross-reference numbers',async()=>{
 const page=parseProductPage(await fixture('spareto-product.html'));
 assert.equal(page.brand,'DT SPARE PARTS');assert.equal(page.partNumber,'1.16046');
 assert.equal(page.image,'https://cdn.spareto.com/variants/images/000/292/567/original/converted.jpg?1676782835');
 assert.deepEqual(page.specifications,[['Inner Diameter','85 mm'],['Material','FKM (fluorocarbon rubber)']]);
 assert.deepEqual(page.oemNumbers,{SCANIA:['1380160','1502384']});
 assert.deepEqual(page.crossReferences,{CORTECO:['12017404','12018654','82018654'],LEMA:['12018654'],'FEBI BILSTEIN':['18796']});
 const data=buildData(page);
 assert.deepEqual(data.crossReferences['DT SPARE PARTS'],['1.16046']);
 assert.deepEqual(data.vehicles,[]);
});

test('identity prefers the same part, then a supplier OE number, then our own brand/part as a cross reference',async()=>{
 const page=parseProductPage(await fixture('spareto-product.html')),data=buildData(page);
 assert.deepEqual(identify({brand:'DT SPARE PARTS',code:'1.16046',oem:''},page,data),{type:'exact_part'});
 assert.deepEqual(identify({brand:'CORTECO',code:'COR 82018654',oem:'1502384'},page,data),
  {type:'oem_reference',reference:'1502384',supplierOem:'1502384',referenceSource:'supplier_oem'});
 const cross=identify({brand:'CORTECO',code:'COR 82018654',oem:''},page,data);
 assert.deepEqual(cross,{type:'cross_reference',reference:'82018654',referenceBrand:'CORTECO'});
 assert.equal(partQuery({brand:'CORTECO',code:'COR 82018654',oem:''}),'82018654');
 // The import contract re-verifies the stored basis against the stored data.
 const pkg=enrichmentImportSchema.parse({supplierItemId:'00000000-0000-4000-8000-000000000001',supplierCode:'COR 82018654',supplierBrand:'CORTECO',
  source:'https://spareto.com/products/dt-shaft-seal-differential/1-16046',sourceMethod:'test',manufacturer:page.brand,partNumber:page.partNumber,
  completeness:'partial',matchBasis:cross,data});
 assert.ok(matchesEnrichment({brand:'CORTECO',code:'COR 82018654',oem:''},pkg));
});

test('cross references never authorize another brand, a cross-reference OE number or an unlisted number',async()=>{
 const page=parseProductPage(await fixture('spareto-product.html')),data=buildData(page);
 // LEMA lists 12018654, but the supplier is FEBI; FEBI's own listed number is a different part.
 assert.equal(identify({brand:'FEBI',code:'FEBI 12018654',oem:''},page,data),null);
 assert.equal(identify({brand:'CORTECO',code:'COR 99999999',oem:''},page,data),null);
 // A supplier OEM found only in the cross-reference table is not an original OE number.
 assert.equal(identify({brand:'ELRING',code:'ELR 1',oem:'12017404'},page,data),null);
 // A supplier OEM equal to the donor's own part number is not an OE number either.
 assert.equal(identify({brand:'FEDERAL',code:'FM 06-879007.50',oem:'1.16046'},page,data),null);
 assert.equal(identify({brand:'OE-PSA',code:'1.16046',oem:''},page,data),null);
 assert.equal(matchesEnrichment({brand:'CORTECO',code:'COR 82018654',oem:''},{manufacturer:page.brand,partNumber:page.partNumber,
  data:{oemNumbers:{},crossReferences:{CORTECO:['12018654']}},matchBasis:{type:'cross_reference',reference:'82018654',referenceBrand:'CORTECO'}}),false);
});

test('a supplier number without the leading zero is the same part',async()=>{
 const page={...parseProductPage(await fixture('spareto-product.html')),brand:'FEBI BILSTEIN',partNumber:'02562',crossReferences:{}};
 assert.deepEqual(identify({brand:'FEBI',code:'FEBI 2562',oem:'',masterBrand:'FEBI'},page,buildData(page)),{type:'exact_part'});
});

test('unrecognized product pages fail instead of importing guessed identities',()=>{
 assert.throws(()=>parseProductPage('<html><h1>Not a product</h1></html>'),/Unrecognized spareto product page/);
});
