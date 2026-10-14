// Enriches products the Trodo pass could not find ("not_found") from otoparcasan.com.
//   collect [--limit N] [--ids file] [--retry]  fetches and verifies; writes packages to the checkpoint only
//   import                                     imports collected packages whose job is still not_found
//   report                                     summarises the checkpoint
import {appendFile,mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {sourcePartQueries} from '../src/modules/enrichment/trodo-adapter';
import {OTOPARCASAN,buildData,codeCandidates,fuelMap,identify,parseProductPage,parseSearch,parseVehicles,supplierOemQueries,toSourceVehicles,uniqueOems,type SourceRow,type Supplier} from '../src/modules/enrichment/otoparcasan-adapter';
import {OtoparcasanClient,SourceBlocked} from '../src/modules/enrichment/otoparcasan-client';
import {importEnrichments} from '../src/modules/enrichment/import';
import {createMatcherCache} from '../src/modules/enrichment/matcher-cache';
import {loadFitmentMatcher} from '../src/modules/store/fitment-sync';
import {enrichmentImportSchema} from '../src/modules/store/enrichment-contract';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const [command='report',...args]=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
const checkpoint=resolve(option('out')||'artifacts/otoparcasan/results.jsonl');
type Entry={supplierItemId:string;outcome:'collected'|'not_found'|'error'|'imported'|'skipped';at:string;url?:string;error?:string;
 counts?:{oems:number;specifications:number;vehicles:number;commercial:number;invalid:number;matched:number};package?:unknown};
const record=async(entry:Omit<Entry,'at'>)=>{await mkdir(resolve(checkpoint,'..'),{recursive:true});await appendFile(checkpoint,JSON.stringify({...entry,at:new Date().toISOString()})+'\n');};
async function entries(){
 const latest=new Map<string,Entry>();
 try{for(const line of (await readFile(checkpoint,'utf8')).split('\n'))if(line.trim()){const e=JSON.parse(line) as Entry;
  // An import outcome keeps the collected package it refers to.
  latest.set(e.supplierItemId,e.outcome==='imported'||e.outcome==='skipped'?{...latest.get(e.supplierItemId),...e}:e);}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return latest;
}
const supplierSql=`SELECT j.supplier_item_id AS id,s.code,COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,
 COALESCE(s.product_data->>'oe','') AS oem FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id WHERE j.status='not_found'`;

async function find(client:OtoparcasanClient,supplier:Supplier){
 const searched=new Set<string>();
 const search=async(query:string)=>{const key=query.toLowerCase().replace(/\s+/g,' ').trim();if(searched.has(key)||key.length<3)return [];searched.add(key);
  return parseSearch(await client.post('Ajax/searchAll/',{trimKeywords:key}));};
 const urls:string[]=[];
 // Searches only discover candidates; identity is decided on the product page by the import contract.
 const queries=sourcePartQueries(supplier.brand,supplier.code),[head,...tail]=queries[0].split(/\s+/);
 // The slug ends with the code without an unregistered supplier prefix ("GLS T85010-00" → "…-t85010-00").
 const target=/^[A-Z]{2,5}$/i.test(head)&&/\d/.test(tail.join(''))?tail.join(' '):queries[0];
 for(const query of queries.slice(0,2)){urls.push(...codeCandidates(await search(query),target));if(urls.length)break;}
 if(!urls.length)for(const reference of supplierOemQueries(supplier).slice(0,2))urls.push(...(await search(reference)).slice(0,3).map(r=>r.url));
 for(const url of [...new Set(urls)].slice(0,3)){
  const html=await client.page(url);if(!html)continue;
  const page=parseProductPage(html);
  const basis=identify(supplier,page,{oemNumbers:{OE:uniqueOems(page.oems)},crossReferences:{}});
  if(basis)return {url,page,basis};
 }
 return null;
}

async function collect(){
 const done=await entries(),limit=Number(option('limit')||50),retry=args.includes('--retry');
 const ids=option('ids')?(await readFile(option('ids')!,'utf8')).split(/\s+/).filter(Boolean):null;
 const rows=(await pool.query<Supplier&{id:string}>(supplierSql+(ids?' AND j.supplier_item_id=ANY($1::uuid[])':'')+' ORDER BY j.supplier_item_id',ids?[ids]:[])).rows
  .filter(row=>retry?done.get(row.id)?.outcome!=='imported':!done.has(row.id)).slice(0,limit);
 const fuels=fuelMap((await pool.query('SELECT DISTINCT fuel_name,fuel_type FROM vehicle_types')).rows);
 const db=await pool.connect();let match;try{match=await loadFitmentMatcher(db);}finally{db.release();}
 const client=new OtoparcasanClient(Number(process.env.OTOPARCASAN_INTERVAL_MS||1500));
 console.log(JSON.stringify({collecting:rows.length,checkpoint}));
 for(const [index,supplier] of rows.entries()){
  try{
   const found=await find(client,supplier);
   if(!found){await record({supplierItemId:supplier.id,outcome:'not_found'});console.log(`${index+1}/${rows.length} ${supplier.code} → bulunamadı`);continue;}
   const sourceRows:SourceRow[]=[];let failedMakers=0;
   for(const maker of found.page.makers){
    try{sourceRows.push(...parseVehicles(await client.post('Ajax/getCarsByStokAndMarkaAndModel',{stok:maker.stok,manuId:maker.manuId})));}
    catch(error){if(error instanceof SourceBlocked)throw error;failedMakers++;}
   }
   const vehicle=toSourceVehicles(sourceRows,fuels),data=buildData(found.page,vehicle.vehicles);
   const pkg=enrichmentImportSchema.parse({supplierItemId:supplier.id,supplierCode:supplier.code,supplierBrand:supplier.brand,source:OTOPARCASAN+found.url,
    sourceMethod:`otoparcasan.com public HTTP adapter v1; ${found.basis.type==='exact_part'?'exact brand/part verified':'original OEM verified: '+found.basis.reference}; commercial vehicles dropped ${vehicle.commercial}; invalid rows ${vehicle.invalid.length}; failed makes ${failedMakers}`,
    manufacturer:found.page.brand,partNumber:found.page.partNumber,matchBasis:found.basis,completeness:failedMakers||vehicle.invalid.length?'partial':'complete',data});
   const matched=data.vehicles.map(match).filter(row=>row.status==='matched').length;
   const counts={oems:Object.values(data.oemNumbers).flat().length,specifications:data.specifications.length,vehicles:data.vehicles.length,commercial:vehicle.commercial,invalid:vehicle.invalid.length,matched};
   await record({supplierItemId:supplier.id,outcome:'collected',url:pkg.source,counts,package:pkg});
   console.log(`${index+1}/${rows.length} ${supplier.code} → ${pkg.source} [${found.basis.type}] OEM ${counts.oems} · özellik ${counts.specifications} · araç ${counts.matched}/${counts.vehicles} eşleşti · kamyon ${counts.commercial} atıldı`);
  }catch(error){
   if(error instanceof SourceBlocked){console.error(String(error));process.exitCode=2;break;}
   await record({supplierItemId:supplier.id,outcome:'error',error:String(error)});console.log(`${index+1}/${rows.length} ${supplier.code} → hata: ${error}`);
  }
 }
 console.log(JSON.stringify({requests:client.requests}));
}

async function runImport(){
 const pending=[...(await entries()).values()].filter(e=>e.outcome==='collected'&&e.package);
 const open=new Set((await pool.query<{id:string}>("SELECT supplier_item_id AS id FROM product_enrichment_jobs WHERE status='not_found' AND supplier_item_id=ANY($1::uuid[])",[pending.map(e=>e.supplierItemId)])).rows.map(r=>r.id));
 const matcher=createMatcherCache();let imported=0,skipped=0;
 for(const entry of pending){
  if(!open.has(entry.supplierItemId)){skipped++;await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:'job is no longer not_found'});continue;}
  try{await importEnrichments(pool,[entry.package],matcher);imported++;await record({supplierItemId:entry.supplierItemId,outcome:'imported'});}
  catch(error){skipped++;await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:String(error)});console.error(entry.supplierItemId,String(error));}
 }
 console.log(JSON.stringify({imported,skipped}));
}

async function report(){
 const all=[...(await entries()).values()],by=(outcome:string)=>all.filter(e=>e.outcome===outcome).length;
 const counts=all.flatMap(e=>e.counts?[e.counts]:[]),sum=(key:keyof NonNullable<Entry['counts']>)=>counts.reduce((total,c)=>total+c[key],0);
 console.log(JSON.stringify({checkpoint,total:all.length,collected:by('collected'),imported:by('imported'),skipped:by('skipped'),notFound:by('not_found'),errors:by('error'),
  withOems:counts.filter(c=>c.oems).length,withSpecifications:counts.filter(c=>c.specifications).length,withVehicles:counts.filter(c=>c.vehicles).length,
  vehicles:sum('vehicles'),matchedVehicles:sum('matched'),commercialDropped:sum('commercial'),invalidRows:sum('invalid')},null,1));
}

try{
 if(command==='collect')await collect();else if(command==='import')await runImport();else if(command==='report')await report();
 else throw Error('Usage: otoparcasan-enrichment.ts collect|import|report');
}finally{await pool.end();}
