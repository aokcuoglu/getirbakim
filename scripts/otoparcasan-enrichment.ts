// Enriches products the Trodo pass could not find ("not_found") from otoparcasan.com.
//   collect [--limit N] [--ids file] [--status not_found|pending|review] [--retry] [--dry-run]
//                 fetches, verifies and writes each product as it is found, like the Trodo worker; --dry-run only
//                 appends packages to the checkpoint. Packages left unwritten by an earlier run are written first.
//                 --status pending searches jobs Trodo has not visited yet, one supplier row per master product;
//                 --status review searches jobs where Trodo found candidates it could not verify.
//   import        writes collected packages whose job is still not_found
//   images        adds the product photo to otoparcasan enrichments written without one
//   report        summarises the checkpoint
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {sourcePartQueries} from '../src/modules/enrichment/trodo-adapter';
import {OTOPARCASAN,buildData,codeCandidates,fuelMap,identify,imageSize,parseProductPage,parseSearch,parseVehicles,supplierOemQueries,toSourceVehicles,uniqueOems,type SourceRow,type Supplier} from '../src/modules/enrichment/otoparcasan-adapter';
import {OtoparcasanClient,SourceBlocked} from '../src/modules/enrichment/otoparcasan-client';
import {importEnrichments,storeProductImage} from '../src/modules/enrichment/import';
import {createMatcherCache} from '../src/modules/enrichment/matcher-cache';
import {loadFitmentMatcher} from '../src/modules/store/fitment-sync';
import {enrichmentImportSchema} from '../src/modules/store/enrichment-contract';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
// A dropped idle connection must not crash the run; the next query reconnects.
pool.on('error',error=>console.error('Database connection lost:',String(error)));
const [command='report',...args]=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
const checkpoint=resolve(option('out')||'artifacts/otoparcasan/results.jsonl');
type Entry={supplierItemId:string;outcome:'collected'|'not_found'|'error'|'imported'|'skipped';at:string;url?:string;error?:string;
 counts?:{image?:boolean;oems:number;specifications:number;vehicles:number;commercial:number;invalid:number;matched:number};package?:unknown};
const record=async(entry:Omit<Entry,'at'>)=>{await mkdir(resolve(checkpoint,'..'),{recursive:true});await appendFile(checkpoint,JSON.stringify({...entry,at:new Date().toISOString()})+'\n');};
async function entries(){
 const latest=new Map<string,Entry>();
 try{for(const line of (await readFile(checkpoint,'utf8')).split('\n'))if(line.trim()){const e=JSON.parse(line) as Entry;
  // An import outcome keeps the collected package it refers to.
  latest.set(e.supplierItemId,e.outcome==='imported'||e.outcome==='skipped'?{...latest.get(e.supplierItemId),...e}:e);}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return latest;
}
const statuses=['not_found','pending','review'] as const;
const status=(option('status')||'not_found') as typeof statuses[number];
if(!statuses.includes(status))throw Error('--status must be not_found, pending or review');
// One supplier row per master product (present rows first); a product already enriched through another row is skipped.
const supplierSql=`SELECT DISTINCT ON (COALESCE(ps.product_id,j.supplier_item_id)) j.supplier_item_id AS id,s.code,
 COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS "masterBrand"
 FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id LEFT JOIN product_sources ps ON ps.supplier_item_id=s.id
 WHERE j.status=$1 AND NOT EXISTS(SELECT 1 FROM product_sources other JOIN product_enrichment_jobs done ON done.supplier_item_id=other.supplier_item_id
  WHERE other.product_id=ps.product_id AND done.status IN ('complete','partial'))`;

class DatabaseUnavailable extends Error {}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const connectionError=(error:unknown)=>{const e=error as {code?:string;message?:string};
 return /^(08|57P0)/.test(e.code||'')||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','EHOSTUNREACH'].includes(e.code||'')
  ||/Connection terminated|connection timeout|Client has encountered a connection error|terminating connection/i.test(e.message||'');};
const matcher=createMatcherCache();
/** Writes one collected package. The package is already in the checkpoint, so a database outage loses nothing:
 *  connection errors are retried with backoff and then stop the run; a contract rejection skips the product. */
async function write(entry:{supplierItemId:string;package?:unknown}){
 for(const [attempt,delay] of [0,5000,30000,120000].entries()){
  if(delay){console.error(`Veritabanına yazılamadı, ${delay/1000} sn sonra tekrar (${attempt}/3)`);await sleep(delay);}
  try{
   // Trodo may have completed the job meanwhile; its result is kept.
   const open=(await pool.query("SELECT 1 FROM product_enrichment_jobs WHERE status IN ('not_found','pending','review') AND supplier_item_id=$1",[entry.supplierItemId])).rowCount;
   if(!open){await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:'job is no longer open'});return 'skipped';}
   await importEnrichments(pool,[entry.package],matcher);
   await record({supplierItemId:entry.supplierItemId,outcome:'imported'});return 'imported';
  }catch(error){
   if(connectionError(error))continue;
   await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:String(error)});console.error(entry.supplierItemId,String(error));return 'skipped';
  }
 }
 throw new DatabaseUnavailable('Database unavailable; collected packages stay in the checkpoint and are written on the next run');
}
async function flush(){
 const pending=[...(await entries()).values()].filter(e=>e.outcome==='collected'&&e.package);
 const counts={imported:0,skipped:0};for(const entry of pending)counts[await write(entry)]++;
 return counts;
}

/** Saves the page's product photo beside the checkpoint; the package references it until it is written. */
async function downloadImage(client:OtoparcasanClient,url:string|null,id:string){
 if(!url)return null;
 const bytes=await client.image(url),size=bytes&&imageSize(bytes);
 if(!bytes||!size)return null;
 const directory=resolve(checkpoint,'..','images');await mkdir(directory,{recursive:true});
 const file=resolve(directory,`${id}.bin`);await writeFile(file,bytes);
 return {file,source:url,...size};
}

async function find(client:OtoparcasanClient,supplier:Supplier){
 const searched=new Set<string>(),opened=new Set<string>();
 const search=async(query:string)=>{const key=query.toLowerCase().replace(/\s+/g,' ').trim();if(searched.has(key)||key.length<3)return [];searched.add(key);
  return parseSearch(await client.post('Ajax/searchAll/',{trimKeywords:key}));};
 // Searches only discover candidates; identity is decided on the product page by the import contract.
 const open=async(urls:string[])=>{
  for(const url of urls.filter(u=>!opened.has(u)).slice(0,3)){
   opened.add(url);const html=await client.page(url);if(!html)continue;
   const page=parseProductPage(html);
   const basis=identify(supplier,page,{oemNumbers:{OE:uniqueOems(page.oems)},crossReferences:{}});
   if(basis)return {url,page,basis};
  }
  return null;
 };
 // Every spelling of the part number is tried until a candidate is verified ("230 845", "230845", "02562" for a
 // supplier's "2562"…); a slug must end with one of them ("…-sachs-230845"), an unregistered prefix dropped.
 const spellings=sourcePartQueries(supplier.masterBrand||supplier.brand,supplier.code);
 const targets=spellings.flatMap(q=>{const [head,...tail]=q.split(/\s+/);return /^[A-Z]{2,5}$/i.test(head)&&/\d/.test(tail.join(''))?[q,tail.join(' ')]:[q];});
 for(const query of spellings){const found=await open(codeCandidates(await search(query),targets));if(found)return found;}
 for(const reference of supplierOemQueries(supplier).slice(0,2)){const found=await open((await search(reference)).slice(0,3).map(r=>r.url));if(found)return found;}
 return null;
}

async function collect(){
 const dryRun=args.includes('--dry-run');
 if(!dryRun){const flushed=await flush();if(flushed.imported||flushed.skipped)console.log(JSON.stringify({pendingWritten:flushed}));}
 const done=await entries(),limit=Number(option('limit')||50),retry=args.includes('--retry');
 const ids=option('ids')?(await readFile(option('ids')!,'utf8')).split(/\s+/).filter(Boolean):null;
 const rows=(await pool.query<Supplier&{id:string}>(`SELECT * FROM (${supplierSql}${ids?' AND j.supplier_item_id=ANY($2::uuid[])':''}
  ORDER BY COALESCE(ps.product_id,j.supplier_item_id),s.presence='present' DESC,j.supplier_item_id) x ORDER BY id`,ids?[status,ids]:[status])).rows
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
   const image=await downloadImage(client,found.page.image,supplier.id);
   if(image){data.imageWidth=image.width;data.imageHeight=image.height;}
   const pkg=enrichmentImportSchema.parse({supplierItemId:supplier.id,supplierCode:supplier.code,supplierBrand:supplier.brand,source:OTOPARCASAN+found.url,
    sourceMethod:`otoparcasan.com public HTTP adapter v1; ${found.basis.type==='exact_part'?'exact brand/part verified':'original OEM verified: '+found.basis.reference}; commercial vehicles dropped ${vehicle.commercial}; invalid rows ${vehicle.invalid.length}; failed makes ${failedMakers}`,
    manufacturer:found.page.brand,partNumber:found.page.partNumber,matchBasis:found.basis,imageFile:image?.file,imageSource:image?.source,completeness:failedMakers||vehicle.invalid.length?'partial':'complete',data});
   const matched=data.vehicles.map(match).filter(row=>row.status==='matched').length;
   const counts={image:Boolean(image),oems:Object.values(data.oemNumbers).flat().length,specifications:data.specifications.length,vehicles:data.vehicles.length,commercial:vehicle.commercial,invalid:vehicle.invalid.length,matched};
   await record({supplierItemId:supplier.id,outcome:'collected',url:pkg.source,counts,package:pkg});
   const written=dryRun?'toplandı':await write({supplierItemId:supplier.id,package:pkg})==='imported'?'yazıldı':'yazılmadı';
   console.log(`${index+1}/${rows.length} ${supplier.code} → ${pkg.source} [${found.basis.type}] OEM ${counts.oems} · özellik ${counts.specifications} · araç ${counts.matched}/${counts.vehicles} eşleşti · görsel ${image?'var':'yok'} · kamyon ${counts.commercial} atıldı · ${written}`);
  }catch(error){
   if(error instanceof SourceBlocked||error instanceof DatabaseUnavailable){console.error(String(error));process.exitCode=2;break;}
   if(connectionError(error)){console.error('Veritabanı bağlantısı yok:',String(error));process.exitCode=2;break;}
   await record({supplierItemId:supplier.id,outcome:'error',error:String(error)});console.log(`${index+1}/${rows.length} ${supplier.code} → hata: ${error}`);
  }
 }
 console.log(JSON.stringify({requests:client.requests}));
}

async function runImport(){console.log(JSON.stringify(await flush()));}

// Photos for products written before the source adapter fetched them. Products whose page has no usable photo are
// logged in images.jsonl and not retried; imported_at moves so storefront:sync ships the change.
async function images(){
 const log=resolve(checkpoint,'..','images.jsonl'),tried=new Set<string>();
 try{for(const line of (await readFile(log,'utf8')).split('\n'))if(line.trim())tried.add(JSON.parse(line).supplierItemId);}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const rows=(await pool.query<{id:string;url:string}>(`SELECT supplier_item_id AS id,source_url AS url FROM product_enrichments
  WHERE source_url LIKE $1 AND image_id IS NULL ORDER BY supplier_item_id`,[OTOPARCASAN+'%'])).rows.filter(row=>!tried.has(row.id)).slice(0,Number(option('limit')||100000));
 const client=new OtoparcasanClient(Number(process.env.OTOPARCASAN_INTERVAL_MS||1500));let added=0,missing=0;
 console.log(JSON.stringify({images:rows.length}));
 for(const [index,row] of rows.entries()){
  try{
   const slug=row.url.slice(OTOPARCASAN.length),html=await client.page(slug);
   const image=html?await downloadImage(client,parseProductPage(html).image,row.id):null;
   if(!image){missing++;await appendFile(log,JSON.stringify({supplierItemId:row.id,outcome:'no_image',at:new Date().toISOString()})+'\n');console.log(`${index+1}/${rows.length} ${slug} → görsel yok`);continue;}
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    const current=(await db.query('SELECT image_id FROM product_enrichments WHERE supplier_item_id=$1 FOR UPDATE',[row.id])).rows[0];
    if(current&&!current.image_id){
     const imageId=await storeProductImage(db,image.file,image.source);
     await db.query(`UPDATE product_enrichments SET image_id=$2,payload=payload||jsonb_build_object('imageWidth',$3::int,'imageHeight',$4::int),imported_at=now() WHERE supplier_item_id=$1`,[row.id,imageId,image.width,image.height]);
    }
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
   added++;await appendFile(log,JSON.stringify({supplierItemId:row.id,outcome:'image',at:new Date().toISOString()})+'\n');
   console.log(`${index+1}/${rows.length} ${slug} → görsel eklendi (${image.width}×${image.height})`);
  }catch(error){
   if(error instanceof SourceBlocked||connectionError(error)){console.error(String(error));process.exitCode=2;break;}
   console.log(`${index+1}/${rows.length} ${row.url} → hata: ${error}`);
  }
 }
 console.log(JSON.stringify({added,missing,requests:client.requests}));
}

async function report(){
 const all=[...(await entries()).values()],by=(outcome:string)=>all.filter(e=>e.outcome===outcome).length;
 const counts=all.flatMap(e=>e.counts?[e.counts]:[]),sum=(key:Exclude<keyof NonNullable<Entry['counts']>,'image'>)=>counts.reduce((total,c)=>total+c[key],0);
 console.log(JSON.stringify({checkpoint,total:all.length,collected:by('collected'),imported:by('imported'),skipped:by('skipped'),notFound:by('not_found'),errors:by('error'),
  withImages:counts.filter(c=>c.image).length,withOems:counts.filter(c=>c.oems).length,withSpecifications:counts.filter(c=>c.specifications).length,withVehicles:counts.filter(c=>c.vehicles).length,
  vehicles:sum('vehicles'),matchedVehicles:sum('matched'),commercialDropped:sum('commercial'),invalidRows:sum('invalid')},null,1));
}

try{
 if(command==='collect')await collect();else if(command==='import')await runImport();else if(command==='report')await report();else if(command==='images')await images();
 else throw Error('Usage: otoparcasan-enrichment.ts collect|import|images|report');
}finally{await pool.end();}
