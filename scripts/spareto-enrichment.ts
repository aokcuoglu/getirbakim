// Third enrichment source: products neither Trodo nor otoparcasan.com could find are searched on spareto.com.
//   collect [--status not_found|review] [--limit N] [--ids file] [--retry] [--dry-run]
//                 searches the part number and supplier OEM numbers, verifies the identity on the product page and
//                 writes image, specifications and reference numbers as each product is found (partial: no vehicles).
//                 Accepted identities: the same brand/part, an OE number the supplier names in the page's OE table,
//                 or the supplier's own brand/part in the page's cross-reference table (an equivalent part).
//   report        summarises the checkpoint
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {SPARETO,buildData,identify,parseProductPage,parseSearch,partQuery,searchPath,supplierOemQueries,type ProductPage,type Supplier} from '../src/modules/enrichment/spareto-adapter';
import {SparetoClient,SourceBlocked} from '../src/modules/enrichment/spareto-client';
import {imageSize} from '../src/modules/enrichment/otoparcasan-adapter';
import {importEnrichments} from '../src/modules/enrichment/import';
import {createMatcherCache} from '../src/modules/enrichment/matcher-cache';
import {enrichmentImportSchema,matchesSupplierPart} from '../src/modules/store/enrichment-contract';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
pool.on('error',error=>console.error('Database connection lost:',String(error)));
const [command='report',...args]=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
const checkpoint=resolve(option('out')||'artifacts/spareto/results.jsonl');
type Entry={supplierItemId:string;outcome:'collected'|'not_found'|'error'|'imported'|'skipped';at:string;url?:string;error?:string;
 counts?:{image:boolean;oems:number;crossReferences:number;specifications:number;basis:string};package?:unknown};
const record=async(entry:Omit<Entry,'at'>)=>{await mkdir(resolve(checkpoint,'..'),{recursive:true});await appendFile(checkpoint,JSON.stringify({...entry,at:new Date().toISOString()})+'\n');};
async function entries(){
 const latest=new Map<string,Entry>();
 try{for(const line of (await readFile(checkpoint,'utf8')).split('\n'))if(line.trim()){const e=JSON.parse(line) as Entry;
  latest.set(e.supplierItemId,e.outcome==='imported'||e.outcome==='skipped'?{...latest.get(e.supplierItemId),...e}:e);}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return latest;
}
const statuses=['not_found','review'] as const;
const status=(option('status')||'not_found') as typeof statuses[number];
if(!statuses.includes(status))throw Error('--status must be not_found or review');
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
/** Writes one collected package; it is already in the checkpoint, so a database outage loses nothing. */
async function write(entry:{supplierItemId:string;package?:unknown}){
 for(const [attempt,delay] of [0,5000,30000,120000].entries()){
  if(delay){console.error(`Veritabanına yazılamadı, ${delay/1000} sn sonra tekrar (${attempt}/3)`);await sleep(delay);}
  try{
   // Another source may have enriched the job meanwhile; its result is kept.
   const open=(await pool.query("SELECT 1 FROM product_enrichment_jobs WHERE status IN ('not_found','review') AND supplier_item_id=$1",[entry.supplierItemId])).rowCount;
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
async function downloadImage(client:SparetoClient,url:string|null,id:string){
 if(!url)return null;
 const bytes=await client.image(url),size=bytes&&imageSize(bytes);
 if(!bytes||!size)return null;
 const directory=resolve(checkpoint,'..','images');await mkdir(directory,{recursive:true});
 const file=resolve(directory,`${id}.bin`);await writeFile(file,bytes);
 return {file,source:url,...size};
}

const rank={exact_part:0,oem_reference:1,cross_reference:2} as const;
/** Searches only discover candidates; identity is decided on the product page. A card carrying the supplier's own
 *  brand and part is opened first, then the leading candidates of every search until a same-part or OE match. */
async function find(client:SparetoClient,supplier:Supplier){
 const cards=new Map<string,{brand:string;partNumber:string}>();
 for(const query of [...new Set([partQuery(supplier),...supplierOemQueries(supplier).slice(0,2)])]){
  if(query.replace(/[^A-Za-z0-9]/g,'').length<3)continue;
  const html=await client.page(searchPath(query));if(!html)continue;
  for(const card of parseSearch(html).slice(0,8))if(!cards.has(card.path))cards.set(card.path,card);
 }
 const ordered=[...cards].sort(([,a],[,b])=>Number(!matchesSupplierPart(supplier.brand,supplier.code,a.brand,a.partNumber,supplier.masterBrand))
  -Number(!matchesSupplierPart(supplier.brand,supplier.code,b.brand,b.partNumber,supplier.masterBrand)));
 let best:{path:string;page:ProductPage;basis:NonNullable<ReturnType<typeof identify>>}|null=null;
 for(const [path] of ordered.slice(0,5)){
  const html=await client.page(path);if(!html)continue;
  const page=parseProductPage(html),basis=identify(supplier,page,buildData(page));
  if(basis&&(!best||rank[basis.type]<rank[best.basis.type]))best={path,page,basis};
  if(best&&best.basis.type!=='cross_reference')break;
 }
 return {found:best,candidates:cards.size};
}

const describe=(basis:NonNullable<ReturnType<typeof identify>>)=>basis.type==='exact_part'?'exact brand/part verified'
 :basis.type==='oem_reference'?'original OEM verified: '+basis.reference:`cross reference verified: ${basis.referenceBrand} ${basis.reference}`;
async function collect(){
 const dryRun=args.includes('--dry-run');
 if(!dryRun){const flushed=await flush();if(flushed.imported||flushed.skipped)console.log(JSON.stringify({pendingWritten:flushed}));}
 const done=await entries(),limit=Number(option('limit')||50),retry=args.includes('--retry');
 const ids=option('ids')?(await readFile(option('ids')!,'utf8')).split(/\s+/).filter(Boolean):null;
 const rows=(await pool.query<Supplier&{id:string}>(`SELECT * FROM (${supplierSql}${ids?' AND j.supplier_item_id=ANY($2::uuid[])':''}
  ORDER BY COALESCE(ps.product_id,j.supplier_item_id),s.presence='present' DESC,j.supplier_item_id) x ORDER BY id`,ids?[status,ids]:[status])).rows
  .filter(row=>retry?done.get(row.id)?.outcome!=='imported':!done.has(row.id)).slice(0,limit);
 const client=new SparetoClient(Number(process.env.SPARETO_INTERVAL_MS||1500));
 console.log(JSON.stringify({collecting:rows.length,status,checkpoint}));
 for(const [index,supplier] of rows.entries()){
  try{
   const {found,candidates}=await find(client,supplier);
   if(!found){await record({supplierItemId:supplier.id,outcome:'not_found',error:candidates?`${candidates} unverified candidates`:undefined});
    console.log(`${index+1}/${rows.length} ${supplier.code} → bulunamadı${candidates?` (${candidates} aday doğrulanamadı)`:''}`);continue;}
   const data=buildData(found.page),image=await downloadImage(client,found.page.image,supplier.id);
   if(image){data.imageWidth=image.width;data.imageHeight=image.height;}
   const pkg=enrichmentImportSchema.parse({supplierItemId:supplier.id,supplierCode:supplier.code,supplierBrand:supplier.brand,source:SPARETO+found.path,
    sourceMethod:`spareto.com public HTTP adapter v1; ${describe(found.basis)}; vehicles not collected`,
    manufacturer:found.page.brand,partNumber:found.page.partNumber,matchBasis:found.basis,imageFile:image?.file,imageSource:image?.source,completeness:'partial',data});
   const counts={image:Boolean(image),oems:Object.values(data.oemNumbers).flat().length,crossReferences:Object.values(data.crossReferences).flat().length,specifications:data.specifications.length,basis:found.basis.type};
   await record({supplierItemId:supplier.id,outcome:'collected',url:pkg.source,counts,package:pkg});
   const written=dryRun?'toplandı':await write({supplierItemId:supplier.id,package:pkg})==='imported'?'yazıldı':'yazılmadı';
   console.log(`${index+1}/${rows.length} ${supplier.code} → ${pkg.source} [${found.basis.type}] ${found.page.brand} ${found.page.partNumber} · OEM ${counts.oems} · muadil ${counts.crossReferences} · özellik ${counts.specifications} · görsel ${image?'var':'yok'} · ${written}`);
  }catch(error){
   if(error instanceof SourceBlocked||error instanceof DatabaseUnavailable){console.error(String(error));process.exitCode=2;break;}
   if(connectionError(error)){console.error('Veritabanı bağlantısı yok:',String(error));process.exitCode=2;break;}
   await record({supplierItemId:supplier.id,outcome:'error',error:String(error)});console.log(`${index+1}/${rows.length} ${supplier.code} → hata: ${error}`);
  }
 }
 console.log(JSON.stringify({requests:client.requests}));
}

async function report(){
 const all=[...(await entries()).values()],by=(outcome:string)=>all.filter(e=>e.outcome===outcome).length;
 const counts=all.flatMap(e=>e.counts?[e.counts]:[]);
 console.log(JSON.stringify({checkpoint,total:all.length,collected:by('collected'),imported:by('imported'),skipped:by('skipped'),notFound:by('not_found'),errors:by('error'),
  unverifiedCandidates:all.filter(e=>e.outcome==='not_found'&&e.error).length,
  byBasis:Object.fromEntries(['exact_part','oem_reference','cross_reference'].map(b=>[b,counts.filter(c=>c.basis===b).length])),
  withImages:counts.filter(c=>c.image).length,withSpecifications:counts.filter(c=>c.specifications).length},null,1));
}

try{
 if(command==='collect')await collect();else if(command==='report')await report();
 else throw Error('Usage: spareto-enrichment.ts collect|report');
}finally{await pool.end();}
