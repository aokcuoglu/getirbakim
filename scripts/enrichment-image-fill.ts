// Photos for partial products whose data source had none: otoparcasan.com is asked first, then spareto.com, each
// skipped when it is the product's own data source. A candidate is accepted on the same identity rules as the
// collectors (exact brand/part, an OE number in the page's OE table, or the supplier's part in the cross-reference
// table) and only its image is written; the product's vehicles, OEM numbers and specifications are left alone.
//   collect [--status partial] [--limit N] [--dry-run]   products without an image, one per master product; a product
//                 whose candidates have no photo is logged and not retried. A blocked source is left out for the rest
//                 of the run; the run stops when both are.
//   report        summarises the checkpoint
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {OTOPARCASAN,findProduct as findOtoparcasan,imageSize,type Supplier} from '../src/modules/enrichment/otoparcasan-adapter';
import {OtoparcasanClient,SourceBlocked as OtoparcasanBlocked} from '../src/modules/enrichment/otoparcasan-client';
import {SPARETO,findProduct as findSpareto} from '../src/modules/enrichment/spareto-adapter';
import {SparetoClient,SourceBlocked as SparetoBlocked} from '../src/modules/enrichment/spareto-client';
import {attachProductImage,type ImageFillResult} from '../src/modules/enrichment/image-fill';
import {recordAttempt,type FallbackSource} from '../src/modules/enrichment/source-attempts';
import {withSourceLock} from '../src/modules/enrichment/source-lock';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
pool.on('error',error=>console.error('Database connection lost:',String(error)));
const [command='report',...args]=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
const status=option('status')||'partial';
if(status!=='partial')throw Error('--status must be partial');
const dryRun=args.includes('--dry-run');
const checkpoint=resolve(option('out')||'artifacts/image-fill/results.jsonl');
type Entry={supplierItemId:string;outcome:'image'|'no_image'|'error';source?:string;url?:string;result?:ImageFillResult;error?:string;at:string};
const record=async(entry:Omit<Entry,'at'>)=>{await mkdir(resolve(checkpoint,'..'),{recursive:true});await appendFile(checkpoint,JSON.stringify({...entry,at:new Date().toISOString()})+'\n');};
async function entries(){
 const latest=new Map<string,Entry>();
 try{for(const line of (await readFile(checkpoint,'utf8')).split('\n'))if(line.trim()){const e=JSON.parse(line) as Entry;latest.set(e.supplierItemId,e);}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return latest;
}
const connectionError=(error:unknown)=>{const e=error as {code?:string;message?:string};
 return /^(08|57P0)/.test(e.code||'')||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','EHOSTUNREACH'].includes(e.code||'')
  ||/Connection terminated|connection timeout|Client has encountered a connection error|terminating connection/i.test(e.message||'');};

// One supplier row per master product (present rows first) among partial products without an image.
const candidateSql=`SELECT DISTINCT ON (COALESCE(ps.product_id,j.supplier_item_id)) j.supplier_item_id AS id,s.code,
 COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS "masterBrand",
 split_part(e.source_url,'/',3) AS host
 FROM product_enrichment_jobs j JOIN product_enrichments e USING(supplier_item_id) JOIN supplier_items s ON s.id=j.supplier_item_id
 LEFT JOIN product_sources ps ON ps.supplier_item_id=s.id
 WHERE j.status='partial' AND e.image_id IS NULL AND s.code<>''
 ORDER BY COALESCE(ps.product_id,j.supplier_item_id),s.presence='present' DESC,j.supplier_item_id`;
type Candidate=Supplier&{id:string;host:string};

async function saveImage(bytes:Buffer|null,source:string,id:string){
 const size=bytes&&imageSize(bytes);
 if(!bytes||!size)return null;
 const directory=resolve(checkpoint,'..','images');await mkdir(directory,{recursive:true});
 const file=resolve(directory,`${id}.bin`);await writeFile(file,bytes);
 return {file,source,...size};
}
type Found={url:string;basis:string;image:Awaited<ReturnType<typeof saveImage>>};
/** Each source's search: the verified page's photo, or null when nothing verified or the page has no photo. */
const sources:{key:FallbackSource;host:string;blocked:(error:unknown)=>boolean;search:(supplier:Candidate)=>Promise<Found|null>}[]=[];
function setup(){
 const otoparcasan=new OtoparcasanClient(Number(process.env.OTOPARCASAN_INTERVAL_MS||1500)),spareto=new SparetoClient(Number(process.env.SPARETO_INTERVAL_MS||1500));
 sources.push({key:'otoparcasan',host:new URL(OTOPARCASAN).hostname,blocked:error=>error instanceof OtoparcasanBlocked,async search(supplier){
  const found=await findOtoparcasan(otoparcasan,supplier);
  if(!found)return null;
  const image=found.page.image?await saveImage(await otoparcasan.image(found.page.image),found.page.image,supplier.id):null;
  return {url:OTOPARCASAN+found.url,basis:found.basis.type,image};
 }});
 sources.push({key:'spareto',host:new URL(SPARETO).hostname,blocked:error=>error instanceof SparetoBlocked,search:supplier=>withSourceLock(pool,'spareto-source',async()=>{
  const {found}=await findSpareto(spareto,supplier);
  if(!found)return null;
  const image=found.page.image?await saveImage(await spareto.image(found.page.image),found.page.image,supplier.id):null;
  return {url:SPARETO+found.path,basis:found.basis.type,image};
 })});
 return {requests:()=>({otoparcasan:otoparcasan.requests,spareto:spareto.requests})};
}

async function collect(){
 const done=await entries(),limit=Number(option('limit')||100);
 const rows=(await pool.query<Candidate>(candidateSql)).rows.filter(row=>!done.has(row.id)).slice(0,limit);
 const clients=setup(),blocked=new Set<FallbackSource>();
 const counts={image:0,complete:0,noImage:0,errors:0};
 console.log(JSON.stringify({collecting:rows.length,status,checkpoint,dryRun}));
 for(const [index,supplier] of rows.entries()){
  const label=`${index+1}/${rows.length} ${supplier.brand} ${supplier.code}`;
  let found:Found|null=null,searched=0;
  for(const source of sources){
   if(blocked.has(source.key)||source.host===supplier.host)continue;
   try{
    searched++;found=await source.search(supplier);
    if(!dryRun)await recordAttempt(pool,source.key,status,supplier.id,found?.image?'found':'not_found');
    if(found?.image){found={...found,url:found.url};break;}
    found=null;
   }catch(error){
    if(source.blocked(error)){blocked.add(source.key);console.error(String(error));if(!dryRun)await recordAttempt(pool,source.key,status,supplier.id,'blocked');continue;}
    if(connectionError(error))throw error;
    counts.errors++;await record({supplierItemId:supplier.id,outcome:'error',source:source.key,error:String(error)});console.log(`${label} → ${source.key} hata: ${error}`);
   }
  }
  if(blocked.size===sources.length){console.error('Her iki kaynak da engelledi; koşu durdu');process.exitCode=2;break;}
  if(!searched)continue;
  if(!found){counts.noImage++;await record({supplierItemId:supplier.id,outcome:'no_image'});console.log(`${label} → görsel bulunamadı`);continue;}
  const image=found.image!;
  if(dryRun){counts.image++;console.log(`${label} → ${found.url} [${found.basis}] ${image.width}×${image.height} · toplandı`);continue;}
  const result=await attachProductImage(pool,{supplierItemId:supplier.id,...image});
  if(result==='complete')counts.complete++;else if(result==='partial')counts.image++;
  await record({supplierItemId:supplier.id,outcome:'image',source:new URL(found.url).hostname,url:found.url,result});
  console.log(`${label} → ${found.url} [${found.basis}] ${image.width}×${image.height} · ${result==='complete'?'görsel eklendi, tamamlandı':result==='partial'?'görsel eklendi, kısmi kaldı':'yazılmadı'}`);
 }
 console.log(JSON.stringify({...counts,requests:clients.requests()}));
}

async function report(){
 const all=[...(await entries()).values()],by=(outcome:string)=>all.filter(e=>e.outcome===outcome).length;
 console.log(JSON.stringify({checkpoint,total:all.length,images:by('image'),completed:all.filter(e=>e.result==='complete').length,noImage:by('no_image'),errors:by('error'),
  bySource:Object.fromEntries(['otoparcasan.com','spareto.com'].map(host=>[host,all.filter(e=>e.outcome==='image'&&e.source===host).length]))},null,1));
}

try{
 if(command==='collect')await collect();else if(command==='report')await report();
 else throw Error('Usage: enrichment-image-fill.ts collect|report');
}catch(error){
 if(connectionError(error)){console.error('Veritabanı bağlantısı yok:',String(error));process.exitCode=2;}else throw error;
}finally{await pool.end();}
