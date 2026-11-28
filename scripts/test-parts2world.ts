import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {articleIdsFromUrl,articleInfoPath,articleInfoPattern,articleType,articleTypeAnswer,buildData,buildVehicles,identify,identifyBasis,imageUrl,madeBy,makerApplicability,oemBrandMakers,oemList,oemMatchedData,partCodeMakers,type SourceVehicle,parseArticleInfo,parts2worldComplete,productUrl,type CatalogType} from '../src/modules/enrichment/parts2world-adapter';
import {OUTAGE_STREAK,names529,openRow,outageStreak,seen529,unavailableEntry} from '../src/modules/enrichment/parts2world-retry';
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

test('an original-part row matched through an OE number needs that number on the live answer (#394)',async()=>{
 const info=parseArticleInfo(await fixture())!;
 const row={brand:'OE-BMW',code:'11537522999',oem:'',oemReference:'11537522999'};
 const basis=identifyBasis(row,info);
 assert.deepEqual(basis,{type:'oem_reference',reference:'11537522999',supplierOem:'',referenceSource:'original_manufacturer_part_code'});
 assert.equal(identifyBasis({...row,code:'11537522998',oemReference:'11537522998'},info),null);
 assert.equal(identifyBasis({...row,oemReference:null},info),null);
 assert.equal(identifyBasis({...row,brand:'FEBI'},info),null);
 assert.deepEqual(identifyBasis({brand:'FEBI',code:'FEBI 171209',oem:'',oemReference:null},info),{type:'exact_part'});
 // The import contract accepts the package on that basis.
 assert.ok(matchesEnrichment(row,{manufacturer:info.brand,partNumber:info.name,data:buildData(info),matchBasis:basis!}));
});

test('ORIJINAL, WENDERPARTS and WENDER rows reach articles through the OE number in their part code (#396)',async()=>{
 const info=parseArticleInfo(await fixture())!;
 const genuine={brand:'ORIJINAL',code:'ORJINAL 11537522999',oem:'',oemReference:'11537522999'};
 const genuineBasis=identifyBasis(genuine,info);
 assert.deepEqual(genuineBasis,{type:'oem_reference',reference:'11537522999',supplierOem:'',referenceSource:'original_manufacturer_part_code'});
 assert.ok(matchesEnrichment(genuine,{manufacturer:info.brand,partNumber:info.name,data:buildData(info),matchBasis:genuineBasis!}));
 // A replica's code: maker prefix + the OE number it copies + a variant suffix.
 const replica={brand:'WENDERPARTS',code:'WENDERPARTS BA11537522999P1',oem:'',oemReference:'11537522999'};
 const replicaBasis=identifyBasis(replica,info);
 assert.deepEqual(replicaBasis,{type:'oem_reference',reference:'11537522999',supplierOem:'',referenceSource:'replica_part_code'});
 assert.ok(matchesEnrichment(replica,{manufacturer:info.brand,partNumber:info.name,data:buildData(info),matchBasis:replicaBasis!}));
 // Brands outside the rule and numbers the live answer does not list stay unmatched.
 assert.deepEqual(identifyBasis({...replica,brand:'WENDER',code:'WENDER E-BA11537522999'},info),replicaBasis);
 assert.deepEqual(identifyBasis({...replica,brand:'TAIWAN',code:'TAIWAN 11537522999'},info),replicaBasis);
 assert.equal(identifyBasis({...replica,brand:'LOCAL',code:'LOCAL 11537522999'},info),null);
 assert.equal(identifyBasis({...genuine,code:'ORJINAL 11537522998',oemReference:'11537522998'},info),null);
 assert.equal(identifyBasis({...genuine,oemReference:'11537522998'},info),null);
});

test('an OE-number match keeps only the part code maker\'s vehicles (#401)',()=>{
 assert.deepEqual(partCodeMakers({brand:'WENDERPARTS',code:'WENDERPARTS BA66209274428',oem:''}),['BMW','MINI']);
 assert.deepEqual(partCodeMakers({brand:'WENDER',code:'WENDER E-MA2928855422',oem:''}),['MERCEDES-BENZ','SMART']);
 assert.equal(partCodeMakers({brand:'WENDERPARTS',code:'WENDERPARTS JX7B13W029CF',oem:''}),null);
 assert.ok(partCodeMakers({brand:'OE-PSA',code:'9805463680',oem:''})!.includes('CITROEN'));
 assert.deepEqual(partCodeMakers({brand:'ORIJINAL',code:'ORJINAL 5K0807571J',oem:'',make:'VAG'}),['VW','AUDI','SEAT','SKODA','CUPRA','PORSCHE']);
 assert.equal(partCodeMakers({brand:'ORIJINAL',code:'ORJINAL 5K0807571J',oem:'',make:''}),null);
 assert.deepEqual(partCodeMakers({brand:'TAIWAN',code:'TAIWAN 55703231',oem:'',make:'OPEL'}),['OPEL','VAUXHALL']);
 assert.equal(partCodeMakers({brand:'TAIWAN',code:'TAIWAN 55703231',oem:'',make:'TESLA ELEKTRIKLI'}),null);
 assert.equal(partCodeMakers({brand:'FEBI',code:'FEBI 171209',oem:''}),null);
 assert.ok(madeBy(['CITROEN'],'CITROËN C4 II'));assert.ok(madeBy(['FORD'],'FORD OTOSAN'));assert.ok(madeBy(['MINI'],'MINI (GB) R56'));
 assert.ok(!madeBy(['MINI'],'MINIBUS X'));assert.ok(!madeBy(['DS'],'DSK 1'));
 // The catalog type's brand decides; a type the catalog lacks is read by the source's maker name.
 const rows=[{modificationId:19013,manuName:'X'},{modificationId:1,manuName:'VW'},{modificationId:2,manuName:'MINI'}] as SourceVehicle[];
 assert.deepEqual(makerApplicability(rows,['BMW','MINI'],new Map([[19013,catalogType]])).map(r=>r.modificationId),[19013,2]);
});

test('a supplier OE number reaches the article and keeps only the vehicles of the makers listing it (#418)',async()=>{
 const info=parseArticleInfo(await fixture())!;
 const row={brand:'MAHLE',code:'MAHLE OX 123',oem:'11 53 7 522 999, 7522999/KIT',oemReference:'11537522999'};
 const basis=identifyBasis(row,info);
 assert.deepEqual(basis,{type:'oem_reference',reference:'11537522999',supplierOem:row.oem,referenceSource:'supplier_oem'});
 assert.ok(matchesEnrichment(row,{manufacturer:info.brand,partNumber:info.name,data:buildData(info),matchBasis:basis!}));
 // The number must be the supplier's own and listed on the live answer.
 assert.equal(identifyBasis({...row,oem:'11537522998'},info),null);
 assert.equal(identifyBasis({...row,oemReference:'7522999'},info),null);
 assert.deepEqual(oemBrandMakers(info.oenNumbers,'11537522999'),['BMW','MINI']);
 assert.equal(oemBrandMakers(info.oenNumbers,'11537522998'),null);
 const listing=(brand:string)=>({...info,oenNumbers:[{brand,code:'1K0 129 620 D'},{brand:'PEUGEOT',code:'1444 TT'}]});
 assert.deepEqual(oemBrandMakers(listing('VW').oenNumbers,'1K0129620D'),['VW','AUDI','SEAT','SKODA','CUPRA','PORSCHE']);
 assert.deepEqual(oemBrandMakers(listing('CITROËN').oenNumbers,'1K0129620D'),['PEUGEOT','CITROEN','DS']);
 assert.deepEqual(oemBrandMakers(listing('TESLA').oenNumbers,'1K0129620D'),['TESLA']);
 assert.deepEqual(oemBrandMakers(listing('VAG').oenNumbers,'1K0129620D'),['VW','AUDI','SEAT','SKODA','CUPRA','PORSCHE']);
});

test('an OE-matched article keeps vehicles and image, not its EAN, properties or cross references (#422)',async()=>{
 const info=parseArticleInfo(await fixture())!;
 const data={...buildData(info),oemNumbers:{'MERCEDES-BENZ':['A0109978692'],HONDA:['38920-RCA-A01'],'FORD USA':['BR3Z-8620-E']}};
 assert.ok(data.specifications.length&&Object.keys(data.crossReferences).length);
 const kept=oemMatchedData(data,['MERCEDES-BENZ','SMART'],'A 010 997 86 92');
 assert.deepEqual(kept.specifications,[]);assert.deepEqual(kept.crossReferences,{});
 assert.deepEqual(kept.oemNumbers,{'MERCEDES-BENZ':['A0109978692']});
 // Without known makers only the matched number's brand stays; a stored package gives the makers back.
 assert.deepEqual(oemMatchedData(data,null,'38920RCAA01').oemNumbers,{HONDA:['38920-RCA-A01']});
 assert.deepEqual(oemMatchedData(data,['FORD'],'X').oemNumbers,{'FORD USA':['BR3Z-8620-E']});
 assert.deepEqual(oemBrandMakers(oemList(data.oemNumbers),'A0109978692'),['MERCEDES-BENZ','SMART']);
 // The import contract still accepts the stripped package.
 const row={brand:'C',code:'C 6PK 2150',oem:'A0109978692'};
 assert.ok(matchesEnrichment(row,{manufacturer:'GATES',partNumber:'6PK2138',data:kept,matchBasis:{type:'oem_reference',reference:'A0109978692',supplierOem:'A0109978692',referenceSource:'supplier_oem'}}));
});

test('complete needs an image and vehicles with no invalid rows',()=>{
 assert.ok(parts2worldComplete({image:true,vehicles:3,invalid:0}));
 assert.ok(!parts2worldComplete({image:false,vehicles:3,invalid:0}));
 assert.ok(!parts2worldComplete({image:true,vehicles:0,invalid:0}));
 assert.ok(!parts2worldComplete({image:true,vehicles:3,invalid:1}));
});

test('part types (#852): source URLs give back the archived ids; spareInfo is the type; packages carry categories',async()=>{
 const ids={articleId:689320334,linkId:689320335,vehicleTypeId:19013};
 assert.deepEqual(articleIdsFromUrl(productUrl(ids)),ids);
 assert.equal(articleIdsFromUrl('https://www.parts2world.com/tecdoc/#/product?mod=1&link=2'),null);
 assert.equal(articleIdsFromUrl('https://evil.example/tecdoc/#/product?mod=1&link=2&id=3'),null);
 assert.equal(articleIdsFromUrl(productUrl(ids)+'&x=1'),null);
 const raw=await fixture(),info=parseArticleInfo({data:{...raw.data,spareInfo:'  V-ribbed Belt '}})!;
 assert.equal(articleType(info),'V-ribbed Belt');
 assert.equal(articleType(parseArticleInfo({data:{...raw.data,spareInfo:' '}})!),null);
 assert.equal(articleType(parseArticleInfo({data:{...raw.data,spareInfo:null}})!),null);
 const categories=[{source:'trodo' as const,id:10,name:'Belts',path:[{id:3,name:'Car parts'},{id:10,name:'Belts'}]}];
 const data=buildData(info,[],categories);
 assert.deepEqual(data.categories,categories);
 assert.deepEqual(buildData(info).categories,[]);
 assert.deepEqual(oemMatchedData(data,['BMW'],'11287549588').categories,categories);
 const pkg=enrichmentImportSchema.parse({supplierItemId:'00000000-0000-4000-8000-000000000001',supplierCode:'171209',supplierBrand:'FEBI',
  source:productUrl(ids),sourceMethod:'test',manufacturer:info.brand,partNumber:info.name,matchBasis:{type:'exact_part'},completeness:'partial',data});
 assert.deepEqual(pkg.data.categories,categories);
});

test('fetch-types answers (#852): a 404 or empty answer is no article, a rejected one is invalid, never an error',async()=>{
 const raw=await fixture();
 assert.deepEqual(articleTypeAnswer(null),{kind:'none'});
 assert.deepEqual(articleTypeAnswer({data:null}),{kind:'none'});
 const named=articleTypeAnswer({data:{...raw.data,spareInfo:'Brake Disc'}});
 assert.equal(named.kind,'article');
 assert.equal(named.kind==='article'&&named.type,'Brake Disc');
 const fromFixture=articleTypeAnswer(raw);
 assert.equal(fromFixture.kind==='article'&&fromFixture.type,'Radiator Hose');
 const unnamed=articleTypeAnswer({data:{...raw.data,spareInfo:null}});
 assert.equal(unnamed.kind==='article'&&unnamed.type,null);
 for(const bad of [{},'<html>',{data:{id:'x'}}]){const answer=articleTypeAnswer(bad);assert.equal(answer.kind,'invalid');}
});

test('a first 529 is retried, a second is final (#1469)',()=>{
 const msg='HTTP 529 for /api/v2/tecdoc/article-info/1/2/3/';
 const first=unavailableEntry(msg,false),second=unavailableEntry(msg,true);
 assert.equal(first.outcome,'error');assert.equal(first.error,`Error: ${msg}`);assert.ok(names529(first));
 assert.equal(second.outcome,'not_found');assert.ok(names529(second));assert.match(second.error,/second HTTP 529/);
 const err529={outcome:'error',error:`Error: ${msg}`},fetchFailed={outcome:'error',error:'TypeError: fetch failed'};
 const final={outcome:'not_found',error:second.error};
 assert.ok(openRow(undefined,undefined,false));
 assert.ok(openRow(err529,undefined,false));assert.ok(seen529(err529,undefined));
 assert.ok(openRow(err529,err529,false));assert.ok(seen529(err529,err529));
 assert.ok(!openRow(fetchFailed,undefined,false));assert.ok(!seen529(fetchFailed,undefined));
 assert.ok(!openRow(undefined,final,false));assert.ok(seen529(undefined,final));
 assert.ok(!openRow(err529,fetchFailed,false));
 for(const outcome of['collected','imported','skipped','not_found'])assert.ok(!openRow({outcome},undefined,false)&&!openRow(undefined,{outcome},false));
 assert.ok(openRow({outcome:'collected'},undefined,true));assert.ok(openRow(final,undefined,true));assert.ok(!openRow({outcome:'imported'},undefined,true));
});

test('only consecutive first-time 529s build an outage streak (#1469)',()=>{
 let streak=0;
 for(let i=0;i<OUTAGE_STREAK-1;i++)streak=outageStreak(streak,true);
 assert.equal(streak,OUTAGE_STREAK-1);
 assert.equal(outageStreak(streak,false),0,'a second 529 or any other outcome resets');
 assert.equal(outageStreak(streak,true),OUTAGE_STREAK);
});
