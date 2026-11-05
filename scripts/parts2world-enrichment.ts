// parts2world.com enrichment (#382): TecDoc article data with the full vehicle list in one call, reached through the ids
// of the old v1 parts2world catalog crawl (the site has no part-number search).
//   index --file F   replaces parts2world_articles with the archive export: CSV rows of
//                    brand,part_number,link_id,article_id(optional),vehicle_type_id; produced on the archive DB with
//                    COPY (SELECT b.name,coalesce(nullif(p.part_no,''),p.name),p.article_link_id,p.tecdoc_article_id,
//                     (SELECT min(v.vehicle_type_id) FROM part_vehicle_types v WHERE v.part_id=p.id)
//                     FROM parts p JOIN part_brands b ON b.id=p.brand_id) TO STDOUT WITH (FORMAT csv)
//                    (rows without a vehicle type are dropped: article-info needs one the link belongs to).
//   match            rebuilds parts2world_job_articles: open jobs whose supplier brand/part names an archived article,
//                    by the import contract's own brand/part rule.
//   collect --status partial|pending|not_found [--limit N] [--ids file] [--retry] [--dry-run]
//                    fetches each matched article, re-verifies brand/part on the live answer and writes image,
//                    specifications, OE numbers, cross references and vehicles (TecDoc type ids, linked directly).
//                    pending goes in stock order; a partial product is replaced only by a complete result or one with
//                    more vehicles. One request every PARTS2WORLD_INTERVAL_MS (default 2500) + up to 1 s; HTTP 403/429/503
//                    stops the run, collected packages stay in the checkpoint and are written on the next run.
//   report           summarises the checkpoint
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {PARTS2WORLD,articleInfoPath,buildData,buildVehicles,identify,imageUrl,parseArticleInfo,parts2worldComplete,productUrl,type CatalogType,type Supplier} from '../src/modules/enrichment/parts2world-adapter';
import {Parts2WorldClient,SourceBlocked} from '../src/modules/enrichment/parts2world-client';
import {imageSize} from '../src/modules/enrichment/otoparcasan-adapter';
import {importEnrichments} from '../src/modules/enrichment/import';
import {recordAttempt} from '../src/modules/enrichment/source-attempts';
import {acquireSourceLock,tryExclusiveRun} from '../src/modules/enrichment/source-lock';
import {createMatcherCache} from '../src/modules/enrichment/matcher-cache';
import {enrichmentImportSchema,manufacturerBrandKey,matchesSupplierPart,partKey} from '../src/modules/store/enrichment-contract';

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
pool.on('error',error=>console.error('Database connection lost:',String(error)));
const [command='report',...args]=process.argv.slice(2);
const option=(name:string)=>{const at=args.indexOf('--'+name);return at>=0?args[at+1]:undefined;};
const statuses=['partial','pending','not_found'] as const;
const status=(option('status')||'partial') as typeof statuses[number];
if(command==='collect'&&!statuses.includes(status))throw Error('--status must be partial, pending or not_found');
const checkpoint=resolve(option('out')||'artifacts/parts2world/results.jsonl');
type Entry={supplierItemId:string;outcome:'collected'|'not_found'|'error'|'imported'|'skipped';at:string;url?:string;error?:string;
 counts?:{image:boolean;oems:number;crossReferences:number;specifications:number;vehicles:number;known:number;total:number;invalid:number};package?:unknown};
const record=async(entry:Omit<Entry,'at'>,queue:string=status)=>{await mkdir(resolve(checkpoint,'..'),{recursive:true});await appendFile(checkpoint,JSON.stringify({...entry,at:new Date().toISOString()})+'\n');
 if(!args.includes('--dry-run')&&(entry.outcome==='collected'||entry.outcome==='not_found'||entry.outcome==='error'))
  await recordAttempt(pool,'parts2world',queue,entry.supplierItemId,entry.outcome==='collected'?'found':entry.outcome);};
async function entries(){
 const latest=new Map<string,Entry>();
 try{for(const line of (await readFile(checkpoint,'utf8')).split('\n'))if(line.trim()){const e=JSON.parse(line) as Entry;
  latest.set(e.supplierItemId,e.outcome==='imported'||e.outcome==='skipped'?{...latest.get(e.supplierItemId),...e}:e);}}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return latest;
}
const supplierColumns=`s.code,COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS "masterBrand"`;

/** CSV line with optional double-quoted fields (PostgreSQL's csv format). */
function csvFields(line:string){
 const fields:string[]=[];let field='',quoted=false;
 for(let i=0;i<line.length;i++){const c=line[i];
  if(quoted){if(c==='"'&&line[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
  else if(c==='"')quoted=true;else if(c===','){fields.push(field);field='';}else field+=c;}
 fields.push(field);return fields;
}
async function index(){
 const file=option('file');if(!file)throw Error('index needs --file');
 const rows=new Map<string,[string,string,string,string,number,number,number]>();let read=0,noVehicle=0;
 for await(const line of createInterface({input:createReadStream(resolve(file))})){
  if(!line.trim())continue;read++;
  const [brand,part,link,article,vehicle]=csvFields(line);
  if(!brand||!part||!/^\d+$/.test(link||''))continue;
  if(!/^\d+$/.test(vehicle||'')){noVehicle++;continue;}
  const brandKey=manufacturerBrandKey(brand),key=partKey(part);if(!brandKey||!key)continue;
  const id=`${brandKey}|${key}`;
  // The archive's id is the link id; its TecDoc article id is often blank and the link id then serves as both.
  if(!rows.has(id))rows.set(id,[brandKey,key,brand,part,Number(/^\d+$/.test(article||'')?article:link),Number(link),Number(vehicle)]);
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('TRUNCATE parts2world_articles CASCADE');
  const all=[...rows.values()];
  for(let at=0;at<all.length;at+=5000){
   const chunk=all.slice(at,at+5000);
   await client.query(`INSERT INTO parts2world_articles(brand_key,part_key,brand,part_number,article_id,link_id,vehicle_type_id)
    SELECT * FROM unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::bigint[],$6::bigint[],$7::int[])`,
    [0,1,2,3,4,5,6].map(column=>chunk.map(r=>r[column])));
  }
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 console.log(JSON.stringify({read,withoutVehicle:noVehicle,articles:rows.size}));
 await match();
}

/** Key pairs a supplier row can name: its label and master brand with the code as given and without a leading word
 *  (a supplier prefix such as "BCH 0986…"); matchesSupplierPart decides which of them really names the article. */
function candidateKeys(row:Supplier){
 const codes=[row.code],rest=row.code.trim().split(/\s+/).slice(1);if(rest.length)codes.push(rest.join(' '));
 const keys=new Set<string>();
 for(const brand of [row.brand,row.masterBrand])if(brand)for(const code of codes)keys.add(`${manufacturerBrandKey(brand)}|${partKey(code)}`);
 return [...keys];
}
async function match(){
 const articles=new Map<string,{brand:string;part:string}>();
 for(const row of (await pool.query<{brand_key:string;part_key:string;brand:string;part_number:string}>('SELECT brand_key,part_key,brand,part_number FROM parts2world_articles')).rows)
  articles.set(`${row.brand_key}|${row.part_key}`,{brand:row.brand,part:row.part_number});
 const found:{id:string;key:string}[]=[];let scanned=0,after='00000000-0000-0000-0000-000000000000';
 for(;;){
  const rows=(await pool.query<Supplier&{id:string}>(`SELECT j.supplier_item_id AS id,${supplierColumns} FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id
   WHERE j.status IN ('pending','partial','not_found','review') AND j.supplier_item_id>$1 ORDER BY j.supplier_item_id LIMIT 20000`,[after])).rows;
  if(!rows.length)break;
  for(const row of rows){
   scanned++;
   for(const key of candidateKeys(row)){const article=articles.get(key);
    if(article&&matchesSupplierPart(row.brand,row.code,article.brand,article.part,row.masterBrand)){found.push({id:row.id,key});break;}}
  }
  after=rows[rows.length-1].id;
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query('TRUNCATE parts2world_job_articles');
  for(let at=0;at<found.length;at+=5000){const chunk=found.slice(at,at+5000);
   await client.query(`INSERT INTO parts2world_job_articles(supplier_item_id,brand_key,part_key)
    SELECT id,split_part(key,'|',1),split_part(key,'|',2) FROM unnest($1::uuid[],$2::text[]) AS r(id,key)`,[chunk.map(r=>r.id),chunk.map(r=>r.key)]);}
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 const byStatus=(await pool.query<{status:string;count:number}>(`SELECT j.status,count(*)::int AS count FROM parts2world_job_articles m
  JOIN product_enrichment_jobs j USING(supplier_item_id) GROUP BY 1 ORDER BY 2 DESC`)).rows;
 console.log(JSON.stringify({articles:articles.size,scanned,matched:found.length,byStatus:Object.fromEntries(byStatus.map(r=>[r.status,r.count]))}));
}

type Row=Supplier&{id:string;articleId:string;linkId:string;vehicleTypeId:number};
// One supplier row per master product (present rows first). A product another row already enriched is skipped; for the
// partial queue only a complete one. Pending, like Trodo and spareto, takes only storefront catalog products still
// pending there (a supplier row linked to no master product is not in the catalog, #386), goes in the Trodo pass's
// stock tiers and leaves products in an unfinished Trodo run to it.
const queueSql=(withIds:boolean)=>`SELECT id,code,brand,oem,"masterBrand","articleId","linkId","vehicleTypeId" FROM (
 SELECT DISTINCT ON (COALESCE(ps.product_id,j.supplier_item_id)) j.supplier_item_id AS id,${supplierColumns},
  a.article_id::text AS "articleId",a.link_id::text AS "linkId",a.vehicle_type_id AS "vehicleTypeId",
  CASE WHEN c.id IS NULL THEN 3 WHEN COALESCE((c.stock_data->>'stok')::numeric,0)>0 OR COALESCE((c.stock_data->>'sFarkliDepo')::numeric,0)>0 THEN 1 ELSE 2 END AS tier
 FROM parts2world_job_articles m JOIN parts2world_articles a USING(brand_key,part_key)
 JOIN product_enrichment_jobs j ON j.supplier_item_id=m.supplier_item_id JOIN supplier_items s ON s.id=j.supplier_item_id
 LEFT JOIN product_sources ps ON ps.supplier_item_id=s.id LEFT JOIN commerce_supplier_items c ON c.id=j.supplier_item_id
 WHERE j.status=$1${withIds?' AND j.supplier_item_id=ANY($2::uuid[])':''}
  AND NOT EXISTS(SELECT 1 FROM product_sources other JOIN product_enrichment_jobs done ON done.supplier_item_id=other.supplier_item_id
   WHERE other.product_id=ps.product_id AND done.status IN (${status==='partial'?"'complete'":"'complete','partial'"}))
  ${status==='pending'?`AND EXISTS(SELECT 1 FROM enrichment_product_catalog pc WHERE pc.product_id=ps.product_id AND pc.status='pending')
   AND NOT EXISTS(SELECT 1 FROM enrichment_run_items i JOIN enrichment_runs r ON r.id=i.run_id
   WHERE i.product_id=ps.product_id AND r.status IN ('prepared','running','blocked','stopped'))`:''}
 ORDER BY COALESCE(ps.product_id,j.supplier_item_id),s.presence='present' DESC,j.supplier_item_id) x
 ORDER BY tier,md5(id::text)`;

class DatabaseUnavailable extends Error {}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const connectionError=(error:unknown)=>{const e=error as {code?:string;message?:string};
 return /^(08|57P0)/.test(e.code||'')||['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','ENOTFOUND','EHOSTUNREACH'].includes(e.code||'')
  ||/Connection terminated|connection timeout|Client has encountered a connection error|terminating connection/i.test(e.message||'');};
const matcher=createMatcherCache();
/** Writes one collected package; it is already in the checkpoint, so a database outage loses nothing. An open job takes
 *  it; a partial one only a complete package or one with more vehicles (the import refuses a poorer partial from
 *  another source); a complete one is left alone. */
async function write(entry:{supplierItemId:string;package?:unknown}){
 for(const [attempt,delay] of [0,5000,30000,120000].entries()){
  if(delay){console.error(`Veritabanına yazılamadı, ${delay/1000} sn sonra tekrar (${attempt}/3)`);await sleep(delay);}
  try{
   const job=(await pool.query<{status:string;vehicles:number|null}>(`SELECT j.status,jsonb_array_length(COALESCE(e.payload->'vehicles','[]'))::int AS vehicles
    FROM product_enrichment_jobs j LEFT JOIN product_enrichments e USING(supplier_item_id) WHERE j.supplier_item_id=$1`,[entry.supplierItemId])).rows[0];
   const pkg=entry.package as {completeness:'complete'|'partial';data:{vehicles:unknown[]}};
   if(!job||job.status==='complete'){await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:'job is no longer open'});return 'skipped';}
   if(job.status==='partial'&&pkg.completeness==='partial'&&pkg.data.vehicles.length<=(job.vehicles??0)){
    await record({supplierItemId:entry.supplierItemId,outcome:'skipped',error:'no more vehicles than the stored partial'});return 'skipped';}
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
async function downloadImage(client:Parts2WorldClient,url:string|null,id:string){
 if(!url)return null;
 const bytes=await client.image(url),size=bytes&&imageSize(bytes);
 if(!bytes||!size)return null;
 const directory=resolve(checkpoint,'..','images');await mkdir(directory,{recursive:true});
 const file=resolve(directory,`${id}.bin`);await writeFile(file,bytes);
 return {file,source:url,...size};
}

async function collect(){
 const dryRun=args.includes('--dry-run');
 const alone=await tryExclusiveRun(pool,'parts2world-collect');
 if(!alone){console.log(JSON.stringify({skipped:'another parts2world run is going'}));return;}
 const lock=await acquireSourceLock(pool,'parts2world-source');
 const client=new Parts2WorldClient(Number(process.env.PARTS2WORLD_INTERVAL_MS||2500));
 try{
  if(!dryRun){const flushed=await flush();if(flushed.imported||flushed.skipped)console.log(JSON.stringify({pendingWritten:flushed}));}
  const done=await entries(),limit=Number(option('limit')||50),retry=args.includes('--retry');
  const ids=option('ids')?(await readFile(option('ids')!,'utf8')).split(/\s+/).filter(Boolean):null;
  const rows=(await pool.query<Row>(queueSql(Boolean(ids)),ids?[status,ids]:[status])).rows
   .filter(row=>retry?done.get(row.id)?.outcome!=='imported':!done.has(row.id)).slice(0,limit);
  const catalog=new Map((await pool.query<CatalogType>(`SELECT t.id,b.name AS brand,m.name AS model,t.name,t.fuel_type,t.cc,t.hp,t.kwt,
   to_char(t.year_of_constr_from,'YYYY-MM') AS date_from,to_char(t.year_of_constr_to,'YYYY-MM') AS date_to
   FROM vehicle_types t JOIN vehicle_models m ON m.id=t.model_id JOIN vehicle_brands b ON b.id=m.brand_id`)).rows.map(t=>[t.id,t]));
  console.log(JSON.stringify({collecting:rows.length,status,checkpoint,intervalMs:client.intervalMs}));
  let index=0;
  for(const row of rows){
   index++;
   try{
    const ids={articleId:row.articleId,linkId:row.linkId,vehicleTypeId:row.vehicleTypeId};
    const info=parseArticleInfo(await client.articleInfo(articleInfoPath(row.articleId,row.linkId,row.vehicleTypeId)));
    if(!info||!identify(row,info)){
     await record({supplierItemId:row.id,outcome:'not_found',error:info?`answer names ${info.brand} ${info.name}`:'no article for the archived ids'});
     console.log(`${index} ${row.code} → bulunamadı${info?` (yanıt: ${info.brand} ${info.name})`:''}`);continue;
    }
    const vehicle=buildVehicles(info.applicability||[],catalog),data=buildData(info,vehicle.vehicles);
    const image=await downloadImage(client,imageUrl(info),row.id);
    if(image){data.imageWidth=image.width;data.imageHeight=image.height;}
    const complete=parts2worldComplete({image:Boolean(image),vehicles:data.vehicles.length,invalid:vehicle.invalid.length});
    const pkg=enrichmentImportSchema.parse({supplierItemId:row.id,supplierCode:row.code,supplierBrand:row.brand,source:productUrl(ids),
     sourceMethod:`parts2world.com TecDoc API adapter v1; exact brand/part verified; archived article ${row.articleId}/${row.linkId}; catalog types ${vehicle.known}/${vehicle.total}; invalid rows ${vehicle.invalid.length}${image?'':'; no image'}${data.vehicles.length?'':'; no vehicles listed'}`,
     manufacturer:info.brand,partNumber:info.name,matchBasis:{type:'exact_part'},imageFile:image?.file,imageSource:image?.source,completeness:complete?'complete':'partial',data});
    const counts={image:Boolean(image),oems:Object.values(data.oemNumbers).flat().length,crossReferences:Object.values(data.crossReferences).flat().length,
     specifications:data.specifications.length,vehicles:data.vehicles.length,known:vehicle.known,total:vehicle.total,invalid:vehicle.invalid.length};
    await record({supplierItemId:row.id,outcome:'collected',url:pkg.source,counts,package:pkg});
    const written=dryRun?'toplandı':await write({supplierItemId:row.id,package:pkg})==='imported'?`yazıldı (${complete?'tamamlandı':'kısmi'})`:'yazılmadı';
    console.log(`${index} ${row.code} → ${info.brand} ${info.name} · OEM ${counts.oems} · muadil ${counts.crossReferences} · özellik ${counts.specifications} · araç ${vehicle.known}/${vehicle.total} katalogda · görsel ${image?'var':'yok'} · ${written}`);
   }catch(error){
    if(error instanceof SourceBlocked){if(!dryRun)await recordAttempt(pool,'parts2world',status,row.id,'blocked');console.error(String(error));process.exitCode=2;break;}
    if(error instanceof DatabaseUnavailable||connectionError(error)){console.error('Veritabanı bağlantısı yok:',String(error));process.exitCode=2;break;}
    await record({supplierItemId:row.id,outcome:'error',error:String(error)});console.log(`${index} ${row.code} → hata: ${error}`);
   }
  }
 }finally{await lock.release();await alone.release();}
 console.log(JSON.stringify({requests:client.requests}));
}

async function report(){
 const all=[...(await entries()).values()],by=(outcome:string)=>all.filter(e=>e.outcome===outcome).length;
 const counts=all.flatMap(e=>e.counts?[e.counts]:[]),sum=(key:'vehicles'|'known'|'total'|'invalid')=>counts.reduce((total,c)=>total+c[key],0);
 const queue=(await pool.query<{status:string;count:number}>(`SELECT j.status,count(*)::int AS count FROM parts2world_job_articles m
  JOIN product_enrichment_jobs j USING(supplier_item_id) GROUP BY 1 ORDER BY 2 DESC`)).rows;
 console.log(JSON.stringify({checkpoint,source:PARTS2WORLD,total:all.length,collected:by('collected'),imported:by('imported'),skipped:by('skipped'),notFound:by('not_found'),errors:by('error'),
  withImages:counts.filter(c=>c.image).length,withVehicles:counts.filter(c=>c.vehicles).length,vehicles:sum('vehicles'),catalogTypes:sum('known'),sourceTypes:sum('total'),invalidRows:sum('invalid'),
  matchedJobs:Object.fromEntries(queue.map(r=>[r.status,r.count]))},null,1));
}

try{
 if(command==='index')await index();else if(command==='match')await match();
 else if(command==='collect')await collect();else if(command==='report')await report();
 else throw Error('Usage: parts2world-enrichment.ts index --file F|match|collect --status partial|pending|not_found|report');
}finally{await pool.end();}
