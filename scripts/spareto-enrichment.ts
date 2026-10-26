// spareto.com enrichment: a fallback for products Trodo and otoparcasan.com could not find, and a second worker on
// the pending queue next to Trodo.
//   collect [--status pending|not_found|review|partial] [--limit N] [--ids file] [--retry] [--max-models N] [--dry-run]
//                 searches the part number and supplier OEM numbers, verifies the identity on the product page and
//                 writes image, specifications, reference numbers and vehicles as each product is found. Vehicles
//                 load one fitment frame per model; past --max-models (default 150) the product stays partial.
//                 pending follows the Trodo catalog pass's tiers (in stock first), takes brands it has found before
//                 first and walks the rest of each tier from the other end, skips Trodo's unfinished run and runs
//                 alone (spareto-pending lock);
//                 products spareto cannot find stay pending for Trodo.
//                 Accepted identities: the same brand/part, an OE number the supplier names in the page's OE table,
//                 or the supplier's own brand/part in the page's cross-reference table (an equivalent part).
//                 partial re-collects products spareto already wrote as partial (e.g. before it collected vehicles)
//                 into its own checkpoint (artifacts/spareto/partial.jsonl); a result replaces the stored data only
//                 when it is complete or has more vehicles.
//   report        summarises the checkpoint
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {SPARETO,buildData,findProduct as find,identify,improvesPartial,sparetoComplete,parseFitment,resolveVehicles,type FitmentRow,type ProductPage,type Supplier} from '../src/modules/enrichment/spareto-adapter';
import {SparetoClient,SourceBlocked} from '../src/modules/enrichment/spareto-client';
import {imageSize} from '../src/modules/enrichment/otoparcasan-adapter';
import {importEnrichments} from '../src/modules/enrichment/import';
import {recordAttempt} from '../src/modules/enrichment/source-attempts';
import {acquireSourceLock,tryExclusiveRun,withSourceLock} from '../src/modules/enrichment/source-lock';
import {createMatcherCache} from '../src/modules/enrichment/matcher-cache';
import {enrichmentImportSchema} from '../src/modules/store/enrichment-contract';
import {createFitmentMatcher,type FitmentCatalogModel,type FitmentCatalogType} from '../src/modules/store/fitment-matcher';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
pool.on('error',error=>console.error('Database connection lost:',String(error)));
const [command='report',...args]=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
const statuses=['not_found','review','pending','partial'] as const;
const status=(option('status')||'not_found') as typeof statuses[number];
if(!statuses.includes(status))throw Error('--status must be pending, not_found, review or partial');
const checkpoint=resolve(option('out')||(status==='partial'?'artifacts/spareto/partial.jsonl':'artifacts/spareto/results.jsonl'));
type Entry={supplierItemId:string;outcome:'collected'|'not_found'|'error'|'imported'|'skipped';at:string;url?:string;error?:string;
 counts?:{image:boolean;oems:number;crossReferences:number;specifications:number;basis:string;models?:number;modelsFetched?:number;vehicles?:number;resolved?:number;matched?:number;invalid?:number};package?:unknown};
const record=async(entry:Omit<Entry,'at'>)=>{await mkdir(resolve(checkpoint,'..'),{recursive:true});await appendFile(checkpoint,JSON.stringify({...entry,at:new Date().toISOString()})+'\n');
 // The admin page reads searches from the database; a dry run leaves no trace there.
 if(!args.includes('--dry-run')&&(entry.outcome==='collected'||entry.outcome==='not_found'||entry.outcome==='error'))
  await recordAttempt(pool,'spareto',status,entry.supplierItemId,entry.outcome==='collected'?'found':entry.outcome);};
async function entries(){
 const latest=new Map<string,Entry>();
 try{for(const line of (await readFile(checkpoint,'utf8')).split('\n'))if(line.trim()){const e=JSON.parse(line) as Entry;
  latest.set(e.supplierItemId,e.outcome==='imported'||e.outcome==='skipped'?{...latest.get(e.supplierItemId),...e}:e);}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return latest;
}
// One supplier row per master product (present rows first); a product already enriched through another row is skipped.
const supplierSql=`SELECT DISTINCT ON (COALESCE(ps.product_id,j.supplier_item_id)) j.supplier_item_id AS id,s.code,
 COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS "masterBrand"
 FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id LEFT JOIN product_sources ps ON ps.supplier_item_id=s.id
 WHERE j.status=$1 AND NOT EXISTS(SELECT 1 FROM product_sources other JOIN product_enrichment_jobs done ON done.supplier_item_id=other.supplier_item_id
  WHERE other.product_id=ps.product_id AND done.status IN ('complete','partial'))`;
// Partial products spareto wrote; a product another row completed is left alone.
const partialSql=`SELECT DISTINCT ON (COALESCE(ps.product_id,j.supplier_item_id)) j.supplier_item_id AS id,s.code,
 COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS "masterBrand"
 FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id) JOIN supplier_items s ON s.id=j.supplier_item_id
 LEFT JOIN product_sources ps ON ps.supplier_item_id=s.id
 WHERE j.status=$1 AND e.source_url LIKE '${SPARETO}/%' AND NOT EXISTS(SELECT 1 FROM product_sources other JOIN product_enrichment_jobs done ON done.supplier_item_id=other.supplier_item_id
  WHERE other.product_id=ps.product_id AND done.status='complete')`;
// Pending products in the Trodo catalog pass's tiers: in stock, other storefront items, then items no longer offered.
// Within a tier, brands spareto finds and Trodo does not come first (#380): spareto's hit rate (its searches so far,
// from enrichment_source_attempts) times Trodo's miss rate (its finished run items), so brands Trodo matches well are
// left to it and both sources add products the other would not. A brand either source tried fewer than 5 times
// counts as 0.5 for that source, between the known-good and the known-absent; then the tier's reverse hash order.
// The brand rates travel as jsonb parameters: a join would make the planner walk the rate list once per pending row
// (37 s a chunk, or minutes once the tried-id list is long). Products in an unfinished Trodo run are left to it; the
// next chunk is read only when this one is done.
const brandRateSql=`SELECT COALESCE(jsonb_object_agg(brand,hit),'{}'::jsonb) AS rates FROM (SELECT b.supplier_brand AS brand,
  count(*) FILTER (WHERE a.outcome='found')::float/count(*) AS hit FROM enrichment_source_attempts a
  JOIN product_enrichment_jobs b ON b.supplier_item_id=a.supplier_item_id
  WHERE a.source='spareto' AND a.outcome IN ('found','not_found') GROUP BY 1 HAVING count(*)>=5) r`;
const trodoRateSql=`SELECT COALESCE(jsonb_object_agg(supplier_brand,hit),'{}'::jsonb) AS rates FROM (SELECT supplier_brand,
  count(*) FILTER (WHERE status IN ('complete','partial'))::float/count(*) AS hit FROM enrichment_run_items
  WHERE status IN ('complete','partial','review','not_found') GROUP BY 1 HAVING count(*)>=5) r`;
const pendingSql=`SELECT j.supplier_item_id AS id,s.code,
 COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS "masterBrand"
 FROM enrichment_product_catalog j JOIN supplier_items s ON s.id=j.supplier_item_id LEFT JOIN commerce_supplier_items c ON c.id=j.supplier_item_id
 WHERE j.status='pending' AND j.supplier_brand<>'' AND NOT (j.supplier_item_id=ANY($1::uuid[]))
  AND NOT EXISTS(SELECT 1 FROM enrichment_run_items i JOIN enrichment_runs r ON r.id=i.run_id WHERE i.product_id=j.product_id AND r.status IN ('prepared','running','blocked','stopped'))
 ORDER BY CASE WHEN c.id IS NULL THEN 3 WHEN COALESCE((c.stock_data->>'stok')::numeric,0)>0 OR COALESCE((c.stock_data->>'sFarkliDepo')::numeric,0)>0 THEN 1 ELSE 2 END,
  COALESCE(($3::jsonb->>j.supplier_brand)::float,0.5)*(1-COALESCE(($4::jsonb->>j.supplier_brand)::float,0.5)) DESC,md5(j.product_id::text) DESC LIMIT $2`;

class DatabaseUnavailable extends Error {}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const connectionError=(error:unknown)=>{const e=error as {code?:string;message?:string};
 return /^(08|57P0)/.test(e.code||'')||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','EHOSTUNREACH'].includes(e.code||'')
  ||/Connection terminated|connection timeout|Client has encountered a connection error|terminating connection/i.test(e.message||'');};
const matcher=createMatcherCache();
/** Writes one collected package; it is already in the checkpoint, so a database outage loses nothing. */
async function write(entry:{supplierItemId:string;package?:unknown}){
 for(const [attempt,delay] of [0,5000,30000,120000].entries()){
  if(delay){console.error(`Veritabanına yazılamadı, ${delay/1000} sn sonra tekrar (${attempt}/3)`);await sleep(delay);}
  try{
   // Another source may have enriched the job meanwhile; its result is kept.
   const open=(await pool.query("SELECT 1 FROM product_enrichment_jobs WHERE status IN ('pending','not_found','review') AND supplier_item_id=$1",[entry.supplierItemId])).rowCount;
   const stored=open?null:(await pool.query<{vehicles:number}>(`SELECT jsonb_array_length(COALESCE(e.payload->'vehicles','[]')) AS vehicles FROM product_enrichment_jobs j
    JOIN product_enrichments e USING(supplier_item_id) WHERE j.supplier_item_id=$1 AND j.status='partial' AND e.source_url LIKE '${SPARETO}/%'`,[entry.supplierItemId])).rows[0];
   if(!open&&!stored){await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:'job is no longer open'});return 'skipped';}
   const pkg=entry.package as {completeness:'complete'|'partial';data:{vehicles:unknown[]}};
   if(stored&&!improvesPartial(stored,{completeness:pkg.completeness,vehicles:pkg.data.vehicles.length})){
    await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:'no more data than the stored partial'});return 'skipped';}
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
async function downloadImage(client:SparetoClient,url:string|null,id:string){
 if(!url)return null;
 const bytes=await client.image(url),size=bytes&&imageSize(bytes);
 if(!bytes||!size)return null;
 const directory=resolve(checkpoint,'..','images');await mkdir(directory,{recursive:true});
 const file=resolve(directory,`${id}.bin`);await writeFile(file,bytes);
 return {file,source:url,...size};
}

const describe=(basis:NonNullable<ReturnType<typeof identify>>)=>basis.type==='exact_part'?'exact brand/part verified'
 :basis.type==='oem_reference'?'original OEM verified: '+basis.reference:`cross reference verified: ${basis.referenceBrand} ${basis.reference}`;
/** Suppliers to search: the status's whole list, or pending chunks read as the previous chunk is finished. */
async function* suppliers(done:Map<string,Entry>,limit:number,retry:boolean,ids:string[]|null):AsyncGenerator<Supplier&{id:string}>{
 if(status!=='pending'){
  const rows=(await pool.query<Supplier&{id:string}>(`SELECT * FROM (${status==='partial'?partialSql:supplierSql}${ids?' AND j.supplier_item_id=ANY($2::uuid[])':''}
   ORDER BY COALESCE(ps.product_id,j.supplier_item_id),s.presence='present' DESC,j.supplier_item_id) x ORDER BY id`,ids?[status,ids]:[status])).rows
   .filter(row=>retry?done.get(row.id)?.outcome!=='imported':!done.has(row.id)).slice(0,limit);
  yield* rows;return;
 }
 const tried=new Set(done.keys());let left=limit;
 while(left>0){
  const rates=(await pool.query<{rates:unknown}>(brandRateSql)).rows[0].rates;
  const trodoRates=(await pool.query<{rates:unknown}>(trodoRateSql)).rows[0].rates;
  const rows=(await pool.query<Supplier&{id:string}>(pendingSql,[[...tried],Math.min(left,200),JSON.stringify(rates),JSON.stringify(trodoRates)])).rows;
  if(!rows.length)return;
  for(const row of rows){tried.add(row.id);left--;yield row;}
 }
}
async function vehicleRows(client:SparetoClient,page:ProductPage,maxModels:number){
 const rows:FitmentRow[]=[];let fetched=0;
 for(const frame of page.vehicleFrames.slice(0,maxModels)){
  try{const html=await client.page(frame.path);if(html){rows.push(...parseFitment(html,frame.make));fetched++;}}
  catch(error){if(error instanceof SourceBlocked)throw error;}
 }
 return {rows,fetched};
}
async function collect(){
 const dryRun=args.includes('--dry-run');
 if(!dryRun){const flushed=await flush();if(flushed.imported||flushed.skipped)console.log(JSON.stringify({pendingWritten:flushed}));}
 const done=await entries(),limit=Number(option('limit')||50),retry=args.includes('--retry'),maxModels=Number(option('max-models')||150);
 const ids=option('ids')?(await readFile(option('ids')!,'utf8')).split(/\s+/).filter(Boolean):null;
 const models=(await pool.query<FitmentCatalogModel>('SELECT m.id,m.brand_id,m.name,b.name AS brand,b.display_name AS display_brand FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id')).rows;
 const types=(await pool.query<FitmentCatalogType>(`SELECT id,model_id,name,cc,fuel_type,hp,kwt,to_char(year_of_constr_from,'YYYY-MM') AS date_from,
  to_char(year_of_constr_to,'YYYY-MM') AS date_to FROM vehicle_types`)).rows;
 const match=createFitmentMatcher(models,types);
 const client=new SparetoClient(Number(process.env.SPARETO_INTERVAL_MS||1500));
 const alone=status==='pending'?await tryExclusiveRun(pool,'spareto-pending'):null;
 if(status==='pending'&&!alone){console.log(JSON.stringify({skipped:'another pending pass is running'}));return;}
 console.log(JSON.stringify({collecting:limit,status,checkpoint}));
 let index=0;
 // One spareto client at a time: the pending pass yields between products, a queue pass holds the lock throughout.
 const whole=status==='pending'?null:await acquireSourceLock(pool,'spareto-source');
 /** Searches and writes one product; true when the run must stop. */
 const handle=async(supplier:Supplier&{id:string})=>{
  try{
   const {found,candidates}=await find(client,supplier);
   if(!found){await record({supplierItemId:supplier.id,outcome:'not_found',error:candidates?`${candidates} unverified candidates`:undefined});
    console.log(`${index} ${supplier.code} → bulunamadı${candidates?` (${candidates} aday doğrulanamadı)`:''}`);return false;}
   const sourceRows=await vehicleRows(client,found.page,maxModels),vehicle=resolveVehicles(sourceRows.rows,models,types);
   const data=buildData(found.page,vehicle.vehicles),image=await downloadImage(client,found.page.image,supplier.id);
   if(image){data.imageWidth=image.width;data.imageHeight=image.height;}
   const modelCount=found.page.vehicleFrames.length;
   const complete=sparetoComplete({models:modelCount,modelsFetched:sourceRows.fetched,invalid:vehicle.invalid.length,image:Boolean(image),vehicles:data.vehicles.length});
   const pkg=enrichmentImportSchema.parse({supplierItemId:supplier.id,supplierCode:supplier.code,supplierBrand:supplier.brand,source:SPARETO+found.path,
    sourceMethod:`spareto.com public HTTP adapter v2; ${describe(found.basis)}; vehicle models ${sourceRows.fetched}/${modelCount}; catalog-resolved ${vehicle.resolved}/${sourceRows.rows.length}; invalid rows ${vehicle.invalid.length}${image?'':'; no image'}${data.vehicles.length?'':'; no vehicles listed'}`,
    manufacturer:found.page.brand,partNumber:found.page.partNumber,matchBasis:found.basis,imageFile:image?.file,imageSource:image?.source,completeness:complete?'complete':'partial',data});
   const matched=data.vehicles.map(match).filter(row=>row.status==='matched').length;
   const counts={image:Boolean(image),oems:Object.values(data.oemNumbers).flat().length,crossReferences:Object.values(data.crossReferences).flat().length,specifications:data.specifications.length,basis:found.basis.type,
    models:modelCount,modelsFetched:sourceRows.fetched,vehicles:data.vehicles.length,resolved:vehicle.resolved,matched,invalid:vehicle.invalid.length};
   await record({supplierItemId:supplier.id,outcome:'collected',url:pkg.source,counts,package:pkg});
   const written=dryRun?'toplandı':await write({supplierItemId:supplier.id,package:pkg})==='imported'?`yazıldı (${pkg.completeness==='complete'?'tamamlandı':'kısmi'})`:'yazılmadı';
   console.log(`${index} ${supplier.code} → ${pkg.source} [${found.basis.type}] ${found.page.brand} ${found.page.partNumber} · OEM ${counts.oems} · muadil ${counts.crossReferences} · özellik ${counts.specifications} · araç ${matched}/${counts.vehicles} eşleşti (model ${sourceRows.fetched}/${modelCount}) · görsel ${image?'var':'yok'} · ${written}`);
  }catch(error){
   if(error instanceof SourceBlocked&&!dryRun)await recordAttempt(pool,'spareto',status,supplier.id,'blocked');
   if(error instanceof SourceBlocked||error instanceof DatabaseUnavailable){console.error(String(error));process.exitCode=2;return true;}
   if(connectionError(error)){console.error('Veritabanı bağlantısı yok:',String(error));process.exitCode=2;return true;}
   await record({supplierItemId:supplier.id,outcome:'error',error:String(error)});console.log(`${index} ${supplier.code} → hata: ${error}`);
  }
  return false;
 };
 try{
  for await(const supplier of suppliers(done,limit,retry,ids)){
   index++;
   if(whole?await handle(supplier):await withSourceLock(pool,'spareto-source',()=>handle(supplier)))break;
  }
 }finally{await whole?.release();await alone?.release();}
 console.log(JSON.stringify({requests:client.requests}));
}

const sum=(counts:NonNullable<Entry['counts']>[],key:'vehicles'|'resolved'|'matched'|'invalid')=>counts.reduce((total,c)=>total+(c[key]||0),0);
async function report(){
 const all=[...(await entries()).values()],by=(outcome:string)=>all.filter(e=>e.outcome===outcome).length;
 const counts=all.flatMap(e=>e.counts?[e.counts]:[]);
 console.log(JSON.stringify({checkpoint,total:all.length,collected:by('collected'),imported:by('imported'),skipped:by('skipped'),notFound:by('not_found'),errors:by('error'),
  unverifiedCandidates:all.filter(e=>e.outcome==='not_found'&&e.error).length,
  byBasis:Object.fromEntries(['exact_part','oem_reference','cross_reference'].map(b=>[b,counts.filter(c=>c.basis===b).length])),
  withImages:counts.filter(c=>c.image).length,withSpecifications:counts.filter(c=>c.specifications).length,
  withVehicles:counts.filter(c=>c.vehicles).length,vehicles:sum(counts,'vehicles'),resolvedVehicles:sum(counts,'resolved'),matchedVehicles:sum(counts,'matched'),
  invalidRows:sum(counts,'invalid'),modelsCapped:counts.filter(c=>c.models!==undefined&&c.modelsFetched!==c.models).length},null,1));
}

try{
 if(command==='collect')await collect();else if(command==='report')await report();
 else throw Error('Usage: spareto-enrichment.ts collect|report');
}finally{await pool.end();}
