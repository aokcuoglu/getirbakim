import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {articleInfoPath,articleInfoPattern,buildData,buildVehicles,identify,imageUrl,parseArticleInfo,parts2worldComplete,productUrl,type CatalogType} from '../src/modules/enrichment/parts2world-adapter';
import {createFitmentMatcher} from '../src/modules/store/fitment-matcher';
import {enrichmentImportSchema,manufacturerBrandKey,matchesEnrichment,matchesSupplierPart} from '../src/modules/store/enrichment-contract';

const fixture=async()=>JSON.parse(await readFile('tests/fixtures/parts2world-article-info.json','utf8'));
const catalogType:CatalogType={id:19013,brand:'BMW',model:'5 (E60)',name:'523 i',fuel_type:'Petrol',cc:2497,hp:177,kwt:130,date_from:'2005-01',date_to:'2007-03'};

test('article-info answers parse; an empty answer is no article',async()=>{
 const info=parseArticleInfo(await fixture())!;
 assert.equal(info.brand,'FEBI BILSTEIN');assert.equal(info.name,'171209');
 assert.equal(parseArticleInfo({data:null}),null);
 assert.equal(articleInfoPath(689320334,689320334,19013),'/api/v2/tecdoc/article-info/689320334/689320334/19013/');
 assert.ok(articleInfoPattern.test(articleInfoPath(1,2,3)));
 assert.ok(!articleInfoPattern.test('/api/v2/tecdoc/articles/1/2/'));
 assert.equal(productUrl({articleId:1,linkId:2,vehicleTypeId:3}),'https://www.parts2world.com/tecdoc/#/product?mod=3&link=2&id=1');
});

test('vehicles carry the TecDoc type id; known types take the catalog text, unknown ones keep the source text',async()=>{
 const info=parseArticleInfo(await fixture())!;
 const result=buildVehicles(info.applicability!,new Map([[catalogType.id,catalogType]]));
 assert.equal(result.total,3);assert.equal(result.known,1);assert.deepEqual(result.invalid,[]);
 assert.deepEqual(result.vehicles[0],{model:'BMW 5 (E60)',engineAndCodes:'523 i',fuel:'Petrol',kw:130,ps:177,cc:2497,from:'01/2005',to:'03/2007',typeId:19013});
 assert.equal(result.vehicles[1].typeId,22659);assert.equal(result.vehicles[1].model,'BMW 5 (E60)');
 // A duplicated type is listed once; a row without power is invalid and reported.
 const twice=buildVehicles([...info.applicability!,info.applicability![0],{...info.applicability![0],modificationId:999999,kwt:0}],new Map());
 assert.equal(twice.total,4);assert.equal(twice.vehicles.length,3);assert.equal(twice.invalid[0].typeId,999999);
});

test('the matcher links a source type id the catalog knows and falls back to names otherwise',()=>{
 const match=createFitmentMatcher([{id:1,brand_id:1,brand:'BMW',display_brand:'BMW',name:'5 (E60)'}],
  [{id:19013,model_id:1,name:'523 i',cc:2497,fuel_type:'Petrol',hp:177,kwt:130,date_from:'2005-01',date_to:'2007-03'}]);
 const vehicle={model:'SOMETHING ELSE',engineAndCodes:'x',fuel:'Petrol',kw:1,ps:1,cc:1,from:'01/2005',to:null};
 assert.deepEqual(match({...vehicle,typeId:19013},0),{sourceIndex:0,source:{...vehicle,typeId:19013},status:'matched',typeId:19013,candidateTypeIds:[19013]});
 assert.equal(match({...vehicle,typeId:4242},1).status,'model_missing');
 assert.equal(match({model:'BMW 5 (E60)',engineAndCodes:'523 i',fuel:'Petrol',kw:130,ps:177,cc:2497,from:'01/2005',to:'03/2007'},2).typeId,19013);
});

test('data keeps properties, EAN, OE numbers and cross references with the article itself',async()=>{
 const info=parseArticleInfo(await fixture())!,data=buildData(info);
 assert.deepEqual(data.specifications[0],['Cooling Hose','from engine to oil cooler and engine cooler']);
 assert.deepEqual(data.specifications.at(-1),['EAN','4054224712092']);
 assert.deepEqual(Object.keys(data.oemNumbers),['BMW']);
 assert.deepEqual(data.crossReferences['FEBI BILSTEIN'],['171209']);
 assert.deepEqual(data.crossReferences['BGA'],['DS6732R']);
 assert.equal(imageUrl(info),'https://www.parts2world.com/_debug/tecdoc-images/ea/4f/a8/ea4fa8f64f322f3bf05de83fa69b18ec.jpg');
 assert.equal(imageUrl({...info,partImages:[{image:'https://evil.example/x.jpg'}]}),null);
});

test('identity is the supplier brand and part on the live answer, prefixes and TecDoc brand names included',async()=>{
 const info=parseArticleInfo(await fixture())!;
 assert.ok(identify({brand:'FEBI',code:'FEBI 171209',oem:''},info));
 assert.ok(identify({brand:'FEBI BILSTEIN',code:'171209',oem:''},info));
 assert.ok(!identify({brand:'SWAG',code:'171209',oem:''},info));
 assert.ok(!identify({brand:'FEBI',code:'FEBI 171210',oem:''},info));
 assert.equal(manufacturerBrandKey('Schaeffler INA'),'INA');assert.equal(manufacturerBrandKey('AVA Clever Choice'),'AVA');
 assert.ok(matchesSupplierPart('INA','INA 529 0083 10','Schaeffler INA','529 0083 10'));
 const pkg=enrichmentImportSchema.parse({supplierItemId:'00000000-0000-4000-8000-000000000001',supplierCode:'FEBI 171209',supplierBrand:'FEBI',
  source:productUrl({articleId:689320334,linkId:689320334,vehicleTypeId:19013}),sourceMethod:'test',manufacturer:info.brand,partNumber:info.name,
  completeness:'partial',data:buildData(info,buildVehicles(info.applicability!,new Map()).vehicles)});
 assert.ok(matchesEnrichment({brand:'FEBI',code:'FEBI 171209',oem:''},pkg));
 assert.equal(pkg.data.vehicles[0].typeId,19013);
});

test('complete needs an image and vehicles with no invalid rows',()=>{
 assert.ok(parts2worldComplete({image:true,vehicles:3,invalid:0}));
 assert.ok(!parts2worldComplete({image:false,vehicles:3,invalid:0}));
 assert.ok(!parts2worldComplete({image:true,vehicles:0,invalid:0}));
 assert.ok(!parts2worldComplete({image:true,vehicles:3,invalid:1}));
});
