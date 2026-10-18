import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildData,identify,parseFitment,parseProductPage,parseSearch,parseVehicleFrames,partQuery,resolveVehicles,searchPath} from '../src/modules/enrichment/spareto-adapter';
import {createFitmentMatcher} from '../src/modules/store/fitment-matcher';
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

test('vehicle frames are read per make and model, only from the product\'s own fitment paths',async()=>{
 assert.deepEqual(parseVehicleFrames(await fixture('spareto-vehicles.html')),[
  {make:'CHEVROLET',model:'AVEO',path:'/products/mann-filter-oil-filter/w-712-75/fitment?manufacturer_id=35&model_name=AVEO'},
  {make:'CHEVROLET',model:'AVEO / KALOS',path:'/products/mann-filter-oil-filter/w-712-75/fitment?manufacturer_id=35&model_name=AVEO+%2F+KALOS'},
  {make:'TESLA',model:'MODEL 3',path:'/products/bosch-brake-pad-set-disc-brake/0-986-460-087/fitment?manufacturer_id=54234&model_name=MODEL+3'}]);
 assert.deepEqual(parseProductPage(await fixture('spareto-product.html')).vehicleFrames,[]);
});

test('fitment rows keep months, kW, optional HP and ccm; rows without power are dropped',async()=>{
 assert.deepEqual(parseFitment(await fixture('spareto-fitment.html'),'CHEVROLET'),[
  {make:'CHEVROLET',name:'AVEO / KALOS Saloon (T250, T255) 1.4',from:'2005-03',to:'2013-05',kw:69,hp:94,cc:1399},
  {make:'CHEVROLET',name:'AVEO / KALOS Saloon (T250, T255) 1.4',from:'2005-03',to:null,kw:61,hp:null,cc:1399},
  {make:'CHEVROLET',name:'AVEO / KALOS Saloon (T200) 1.5',from:'2004-10',to:'2006-05',kw:63,hp:null,cc:1498}]);
});

test('a row takes fuel and HP only from a single catalog type; others stay unmatched',async()=>{
 const models=[{id:1,brand_id:1,brand:'CHEVROLET',display_brand:'Chevrolet',name:'AVEO / KALOS Saloon (T250, T255)'},
  {id:2,brand_id:1,brand:'CHEVROLET',display_brand:'Chevrolet',name:'AVEO / KALOS Saloon (T200)'},
  {id:3,brand_id:2,brand:'TESLA',display_brand:'Tesla',name:'MODEL 3 (5YJ3)'}];
 const type=(id:number,model_id:number,name:string,kwt:number,hp:number,cc:number|null,fuel_type:string,date_from:string,date_to:string|null)=>({id,model_id,name,kwt,hp,cc,fuel_type,date_from,date_to});
 const types=[type(10,1,'1.4',69,94,1399,'Petrol','2005-03','2013-05'),
  // The source still lists it in production; the catalog has closed it, and it is the only type with this start.
  type(11,1,'1.4',61,83,1399,'Petrol','2005-03','2011-12'),
  // Two catalog types share every attribute the source gives: ambiguous, so no fuel is borrowed.
  type(12,2,'1.5',63,86,1498,'Petrol','2004-10','2006-05'),type(13,2,'1.5',63,86,1498,'Petrol LPG','2004-10','2006-05'),
  type(14,3,'EV AWD',366,498,null,'Electric','2020-12',null)];
 const rows=parseFitment(await fixture('spareto-fitment.html'),'CHEVROLET');
 const tesla={make:'TESLA',name:'MODEL 3 (5YJ3) EV AWD',from:'2020-12',to:null,kw:366,hp:null,cc:null};
 const unknown={make:'CHEVROLET',name:'SPARK 1.0',from:'2010-03',to:null,kw:50,hp:68,cc:995};
 const result=resolveVehicles([...rows,rows[0],tesla,unknown],models,types);
 assert.equal(result.resolved,4);
 assert.deepEqual(result.vehicles.slice(0,2),[
  {model:'CHEVROLET AVEO / KALOS Saloon (T250, T255)',engineAndCodes:'1.4',fuel:'Petrol',kw:69,ps:94,cc:1399,from:'03/2005',to:'05/2013'},
  {model:'CHEVROLET AVEO / KALOS Saloon (T250, T255)',engineAndCodes:'1.4',fuel:'Petrol',kw:61,ps:83,cc:1399,from:'03/2005',to:null}]);
 assert.deepEqual(result.vehicles[2],{model:'CHEVROLET AVEO / KALOS Saloon (T200)',engineAndCodes:'1.5',fuel:'',kw:63,ps:86,cc:1498,from:'10/2004',to:'05/2006'});
 assert.deepEqual(result.vehicles[3],{model:'TESLA MODEL 3 (5YJ3)',engineAndCodes:'EV AWD',fuel:'Electric',kw:366,ps:498,cc:0,from:'12/2020',to:null});
 assert.equal(result.vehicles.length,5,'the repeated row is stored once');
 const match=createFitmentMatcher(models,types);
 assert.deepEqual(result.vehicles.map(match).map(m=>m.status),['matched','matched','attributes_missing','matched','model_missing']);
});
