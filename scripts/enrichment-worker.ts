import {createServer} from 'node:http';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {transform} from 'esbuild';
import {z} from 'zod';
import {SourceQueue,SourceBlocked,WorkerStopped} from '../src/modules/enrichment/source-queue';
import {SOURCE_HOSTS} from '../src/modules/enrichment/policy';
import {sourcePartQuery,searchPath,parseSearch,chooseExact,parseProduct,parseView,collectVehicles,normalizeData,imagePath,safeProductSlug,manufacturerBrandKey} from '../src/modules/enrichment/trodo-adapter';
import {matchesSupplierPart} from '../src/modules/store/enrichment-contract';
import {importEnrichments} from '../src/modules/enrichment/import';
import {createMatcherCache} from '../src/modules/enrichment/matcher-cache';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const command=process.argv[2];
const responseSchema=z.object({id:z.uuid(),token:z.uuid(),httpStatus:z.number().int().min(0).max(599),elapsedMs:z.number().int().min(0).max(120000),bytes:z.number().int().min(0).max(15*1024*1024),retryAfter:z.string().nullable(),error:z.string().max(2000).optional(),body:z.unknown().optional()});
async function prepare(){
 const client=await pool.connect();try{await client.query('BEGIN');await client.query(await readFile('db/enrichment-worker.sql','utf8'));await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function report(runId:string){
 const run=(await pool.query('SELECT * FROM enrichment_runs WHERE id=$1',[runId])).rows[0];
 const outcomes=(await pool.query('SELECT status,count(*)::int AS count FROM enrichment_run_items WHERE run_id=$1 GROUP BY status ORDER BY status',[runId])).rows;
 const stages=(await pool.query("SELECT stage,count(*)::int AS count FROM enrichment_run_items WHERE run_id=$1 AND status IN ('queued','collecting') GROUP BY stage",[runId])).rows;
 const requests=(await pool.query('SELECT host,outcome,http_status,count(*)::int AS count,sum(bytes)::bigint AS bytes FROM enrichment_request_events WHERE run_id=$1 GROUP BY host,outcome,http_status ORDER BY host,outcome',[runId])).rows;
 const brands=(await pool.query('SELECT supplier_brand,count(*)::int AS count FROM enrichment_run_items WHERE run_id=$1 GROUP BY supplier_brand ORDER BY count(*) DESC',[runId])).rows;
 const quality=(await pool.query(`SELECT count(*)::int AS imported,sum(jsonb_array_length(e.payload->'vehicles'))::int AS engines,
 count(*) FILTER(WHERE e.image_id IS NOT NULL)::int AS images FROM enrichment_run_items i JOIN product_enrichments e ON e.supplier_item_id=i.supplier_item_id WHERE i.run_id=$1 AND i.status IN ('complete','partial')`,[runId])).rows[0];
 const results={run,outcomes,stages,requests,brandCount:brands.length,brands,quality};
 await mkdir(`artifacts/enrichment-pilot-${runId}`,{recursive:true});await writeFile(`artifacts/enrichment-pilot-${runId}/report.json`,JSON.stringify(results,null,2));return results;
}
async function createRun(size:number,seed:string){
 if(!Number.isInteger(size)||size<1||size>1000)throw Error('Pilot size must be 1..1000');
 const client=await pool.connect();try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(20261004,1)');
  const active=(await client.query("SELECT id FROM enrichment_runs WHERE status IN ('prepared','running','blocked','stopped') LIMIT 1")).rows[0];if(active)throw Error('Resume existing unfinished run '+active.id);
  const run=(await client.query('INSERT INTO enrichment_runs(seed,sample_size) VALUES($1,$2) RETURNING id',[seed,size])).rows[0];
  // Stable random sample, with one guaranteed representative per supplier brand.
  await client.query(`INSERT INTO enrichment_run_items(run_id,supplier_item_id,ordinal,supplier_code,supplier_brand,oem)
   SELECT $1,supplier_item_id,row_number() OVER(ORDER BY priority,hash)-1,supplier_code,supplier_brand,oem FROM (
    SELECT j.*,md5($2||j.supplier_item_id::text) AS hash,
     CASE WHEN row_number() OVER(PARTITION BY supplier_brand ORDER BY md5($2||j.supplier_item_id::text))=1 THEN 0 ELSE 1 END AS priority
    FROM product_enrichment_jobs j WHERE status='pending' AND NOT EXISTS(SELECT 1 FROM enrichment_run_items i JOIN enrichment_runs r ON r.id=i.run_id WHERE i.supplier_item_id=j.supplier_item_id AND r.status IN ('prepared','running','blocked','stopped'))
   ) s ORDER BY priority,hash LIMIT $3`,[run.id,seed,size]);
  const count=(await client.query('SELECT count(*)::int AS count FROM enrichment_run_items WHERE run_id=$1',[run.id])).rows[0].count;
  if(count!==size)throw Error('Not enough pending jobs');await client.query('COMMIT');
  await mkdir(`artifacts/enrichment-pilot-${run.id}`,{recursive:true});
  const items=(await pool.query('SELECT ordinal,supplier_item_id,supplier_code,supplier_brand,oem FROM enrichment_run_items WHERE run_id=$1 ORDER BY ordinal',[run.id])).rows;
  await writeFile(`artifacts/enrichment-pilot-${run.id}/manifest.json`,JSON.stringify({id:run.id,size,seed,strategy:'One per brand, remainder stable hash sample of pending jobs',items},null,2));return run.id;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function serve(runId:string,port:number){
 const run=(await pool.query('SELECT id FROM enrichment_runs WHERE id=$1',[runId])).rows[0];if(!run)throw Error('Unknown run');
 const token=randomBytes(32).toString('hex'),queue=new SourceQueue(pool,runId),matcher=createMatcherCache();
 const directory=resolve(`artifacts/enrichment-pilot-${runId}`);await mkdir(directory,{recursive:true});
 const secretDirectory=resolve('.local/enrichment');await mkdir(secretDirectory,{recursive:true});
 const clientCode=await readFile('scripts/enrichment-browser-client.js','utf8');
 const compact=await transform(clientCode+`\nvoid startEnrichmentBrowser('http://127.0.0.1:${port}',${JSON.stringify(token)});\n`,{minify:true,target:"es2022"});
 await writeFile(`${secretDirectory}/browser-start.js`,compact.code.trim(),{mode:0o600});
 const server=createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(!origin||!SOURCE_HOSTS.some(h=>origin===`https://${h}`)){res.writeHead(403);res.end();return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const received=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+token);
  if(received.length!==expected.length||!timingSafeEqual(received,expected)){res.writeHead(401);res.end();return;}
  try{
   const url=new URL(req.url||'/',`http://127.0.0.1:${port}`);let result:unknown;
   if(req.method==='GET'&&url.pathname==='/claim'){
    const host=url.searchParams.get('host');if(origin!==`https://${host}`)throw Error('Source origin mismatch');
    const state=(await pool.query('SELECT status FROM enrichment_runs WHERE id=$1',[runId])).rows[0].status;
    result=['complete','blocked','stopped'].includes(state)?{done:true,status:state}:await queue.claim(host!);
   }else if(req.method==='POST'&&url.pathname==='/result'){
    const chunks:Buffer[]=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>15*1024*1024)throw Error('Result too large');chunks.push(chunk);}
    const data=responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));
    const host=(await pool.query('SELECT host FROM enrichment_source_requests WHERE id=$1 AND run_id=$2',[data.id,runId])).rows[0]?.host;
    if(origin!==`https://${host}`)throw Error('Result source mismatch');result=await queue.finish(data);
   }else{res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch(error){console.error('Bridge',String(error));res.writeHead(400);res.end(JSON.stringify({error:String(error)}));}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
 console.log(JSON.stringify({bridge:`http://127.0.0.1:${port}`,runId,browserScript:'.local/enrichment/browser-start.js'}));
 const owner=await pool.connect();
 const locked=(await owner.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[runId])).rows[0].locked;
 if(!locked){server.close();owner.release();throw Error('Run already has a worker');}
 let stopping=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{stopping=true;queue.stopping=true;});
 await pool.query("UPDATE enrichment_runs SET status='running',started_at=coalesce(started_at,now()),finished_at=NULL WHERE id=$1",[runId]);
 try{
  while(!stopping){
   const lease=randomUUID();
   const item=(await pool.query(`WITH picked AS(SELECT supplier_item_id FROM enrichment_run_items WHERE run_id=$1 AND
    (status='queued' OR(status='collecting' AND lease_until<now())) ORDER BY ordinal FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE enrichment_run_items i SET status='collecting',lease_token=$2,lease_until=now()+interval '2 minutes',attempts=attempts+1,started_at=coalesce(started_at,now()) FROM picked WHERE i.run_id=$1 AND i.supplier_item_id=picked.supplier_item_id RETURNING i.*`,[runId,lease])).rows[0];
   if(!item){
    const remaining=(await pool.query("SELECT count(*)::int AS n FROM enrichment_run_items WHERE run_id=$1 AND status IN ('queued','collecting')",[runId])).rows[0].n;
    if(remaining){await new Promise(r=>setTimeout(r,1000));continue;}
    await pool.query("UPDATE enrichment_runs SET status='complete',finished_at=now() WHERE id=$1",[runId]);break;
   }
   const heartbeat=setInterval(()=>void pool.query("UPDATE enrichment_run_items SET lease_until=now()+interval '2 minutes' WHERE run_id=$1 AND supplier_item_id=$2 AND lease_token=$3",[runId,item.supplier_item_id,lease]).catch(console.error),30000);
   const cp=item.checkpoint as Record<string,unknown>;
   async function checkpoint(stage:string,value:Record<string,unknown>){Object.assign(cp,value);await pool.query('UPDATE enrichment_run_items SET stage=$4,checkpoint=$5 WHERE run_id=$1 AND supplier_item_id=$2 AND lease_token=$3',[runId,item.supplier_item_id,lease,stage,JSON.stringify(cp)]);}
   async function outcome(status:string,error?:string){
    const client=await pool.connect();try{await client.query('BEGIN');
     const current=(await client.query("SELECT code,product_data->>'uk' AS brand FROM supplier_items WHERE id=$1 FOR SHARE",[item.supplier_item_id])).rows[0];
     if(!current||current.code!==item.supplier_code||current.brand!==item.supplier_brand){status='review';error='Supplier identity changed during collection';}
     await client.query('UPDATE enrichment_run_items SET status=$4,last_error=$5,finished_at=now(),lease_until=NULL,lease_token=NULL WHERE run_id=$1 AND supplier_item_id=$2 AND lease_token=$3',[runId,item.supplier_item_id,lease,status,error||null]);
     if(!['complete','partial'].includes(status))await client.query("UPDATE product_enrichment_jobs SET status=$2,last_error=$3,attempts=attempts+1,last_attempt_at=now(),updated_at=now() WHERE supplier_item_id=$1 AND supplier_code=$4 AND supplier_brand=$5 AND status<>'complete'",[item.supplier_item_id,status,error||null,item.supplier_code,item.supplier_brand]);
     await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
    console.log(JSON.stringify({ordinal:item.ordinal+1,code:item.supplier_code,status,error}));
   }
   try{
    if(!cp.search){const search=parseSearch(await queue.get('www.trodo.com',searchPath(sourcePartQuery(item.supplier_brand,item.supplier_code))));await checkpoint('identity',{search});}
    const search=parseSearch([cp.search]);const exact=chooseExact(item.supplier_brand,item.supplier_code,search.products);
    if(!exact){
     // Cross-brand OEM results need assembly/position review before any import.
     const refs=(item.oem||'').split(/[,;|\n]+/).map((s:string)=>s.trim()).filter(Boolean).slice(0,2);
     if(!cp.oemSearch&&refs.length){const candidates=[];for(const q of refs)candidates.push({query:q,...parseSearch(await queue.get('www.trodo.com',searchPath(q)))});await checkpoint('review',{oemSearch:candidates});}
     const oemCandidates=z.array(z.object({products:z.array(z.unknown())})).optional().parse(cp.oemSearch);
     const found=search.products.length>0||oemCandidates?.some(s=>s.products.length);
     await outcome(found?'review':'not_found',found?'No unique exact brand/part match; OEM candidates require manual review':'No results in attempted source queries');continue;
    }
    const slug=safeProductSlug(exact);
    if(!cp.product)await checkpoint('view',{product:parseProduct(await queue.get('www.trodo.com','/rest/V1/catalog-product-api/product-url/'+encodeURIComponent(slug)+'/IE'))});
    const product=parseProduct([{attributes:cp.product}]);
    if(!matchesSupplierPart(item.supplier_brand,item.supplier_code,product.manufacturer,product.tecdoc_sku))throw Error('Product identity mismatch');
    if(!cp.view)await checkpoint('vehicles',{view:parseView(await queue.get('www.trodo.com','/rest/V1/catalog-product-api/view-data/'+product.entity_id+'/IE'))});
    const view=parseView([{relationships:cp.view}]);
    if(!cp.vehicle)await checkpoint('image',{vehicle:await collectVehicles(queue,view)});
    const vehicle=z.object({vehicles:z.array(z.unknown()),vehicleModels:z.array(z.string()),coverage:z.object({expected:z.number(),covered:z.number(),unresolved:z.array(z.string()),invalid:z.array(z.unknown())})}).parse(cp.vehicle);
    const data=normalizeData(view,vehicle as Awaited<ReturnType<typeof collectVehicles>>);
    const media=imagePath(product);let imageFile:string|undefined,imageSource:string|undefined;
    if(media){
     if(!cp.image)await checkpoint('logo',{image:await queue.get('picdn.trodo.com',media,'image')});
     const image=z.object({dataUrl:z.string(),width:z.number().int().positive().max(10000),height:z.number().int().positive().max(10000)}).parse(cp.image);
     const encoded=/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);if(!encoded)throw Error('Invalid source image');
     imageFile=resolve(directory,`image-${item.ordinal}.bin`);await writeFile(imageFile,Buffer.from(encoded[1],'base64'));imageSource='https://picdn.trodo.com'+media;data.imageWidth=image.width;data.imageHeight=image.height;
    }
    let brandLogo:{imageFile:string;imageSource:string}|undefined;
    const known=(await pool.query('SELECT 1 FROM manufacturer_logos WHERE brand_key=$1',[manufacturerBrandKey(item.supplier_brand)])).rowCount;
    if(!known){
     if(!cp.logoSource)await checkpoint('logo',{logoSource:await queue.get('www.trodo.com','/'+slug,'html')});
     const logos=z.object({logos:z.array(z.string())}).parse(cp.logoSource).logos;
     const paths=[...new Set(logos.map(s=>new URL(s,'https://www.trodo.com').href).filter(s=>s.startsWith('https://www.trodo.com/media/manufacturer_')))];
     if(paths.length===1){
      if(!cp.logo)await checkpoint('import',{logo:await queue.get('www.trodo.com',new URL(paths[0]).pathname,'logo')});
      const logo=z.object({dataUrl:z.string().regex(/^data:image\/png;base64,/)}).parse(cp.logo);
      const file=resolve(directory,`logo-${manufacturerBrandKey(item.supplier_brand)}.png`);await writeFile(file,Buffer.from(logo.dataUrl.split(',')[1],'base64'));brandLogo={imageFile:file,imageSource:paths[0]};
     }
    }
    const complete=vehicle.coverage.unresolved.length===0&&vehicle.coverage.invalid.length===0&&Boolean(imageFile);
    const pkg={supplierItemId:item.supplier_item_id,supplierCode:item.supplier_code,supplierBrand:item.supplier_brand,source:'https://www.trodo.com/'+slug,sourceMethod:`Durable public browser adapter v1; run ${runId}; exact brand/part verified; source IDs covered ${vehicle.coverage.covered}/${vehicle.coverage.expected}; invalid rows ${vehicle.coverage.invalid.length}`,manufacturer:product.manufacturer,partNumber:product.tecdoc_sku,completeness:complete?'complete':'partial',imageFile,imageSource,brandLogo,data};
    await checkpoint('import',{package:pkg});await importEnrichments(pool,[pkg],matcher);await outcome(complete?'complete':'partial');
   }catch(error){
    if(error instanceof SourceBlocked||error instanceof WorkerStopped){await pool.query("UPDATE enrichment_run_items SET status='queued',lease_token=NULL,lease_until=NULL,last_error=$3 WHERE run_id=$1 AND supplier_item_id=$2",[runId,item.supplier_item_id,String(error)]);await pool.query("UPDATE enrichment_runs SET status=$2 WHERE id=$1",[runId,stopping?'stopped':'blocked']);console.log(stopping?'Worker stopped with checkpoint preserved':'Run paused by source circuit',String(error));break;}
    await outcome('failed',String(error));
   }finally{clearInterval(heartbeat);}
   if((item.ordinal+1)%10===0)await report(runId);
  }
  if(stopping)await pool.query("UPDATE enrichment_runs SET status='stopped' WHERE id=$1 AND status='running'",[runId]);
  console.log(JSON.stringify(await report(runId)));
 }finally{await owner.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[runId]);owner.release();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
try{
 if(command==='prepare'){await prepare();console.log('Durable enrichment queue ready');}
 else if(command==='pilot'){await prepare();console.log(JSON.stringify({runId:await createRun(Number(process.argv[3]||1000),process.argv[4]||'pilot-2026-10-04-v1')}));}
 else if(command==='run')await serve(z.uuid().parse(process.argv[3]),Number(process.argv[4]||4318));
 else if(command==='report')console.log(JSON.stringify(await report(z.uuid().parse(process.argv[3])),null,2));
 else throw Error('Usage: prepare | pilot [size] [seed] | run RUN_ID [port] | report RUN_ID');
}finally{await pool.end();}
