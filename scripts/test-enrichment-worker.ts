import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,symlink,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Pool} from 'pg';
import {sourceDecision,retryAfterMs,validSourcePath,quietWaitMs,pacingDelayMs} from '../src/modules/enrichment/policy';
import {parseProduct,parseSearch,parseView,parseEngine,chooseExact,sourcePartQuery,sourcePartQueries,supplierOemQueries,verifiedOemReference,collectVehicles,imagePath,oemSearchPath,searchPath} from '../src/modules/enrichment/trodo-adapter';
import {SourceQueue,unblockSources} from '../src/modules/enrichment/source-queue';
import {startChromeCollectors} from '../src/modules/enrichment/chrome-driver';
test('long-running Chrome collectors close between successive catalog batches',async t=>{
 const sockets:FakeSocket[]=[];
 class FakeSocket extends EventTarget {
  static OPEN=1;
  readyState=1;
  constructor(readonly url:string){super();sockets.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
  send(message:string){
   const {id,method}=JSON.parse(message);
   const result=method==='Runtime.evaluate'?{result:{value:{host:this.url.split('/').at(-1),ready:'complete',blocked:false,challenge:false,title:'Source'}}}:{};
   queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id,result})})));
  }
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 }
 const originalSocket=globalThis.WebSocket;
 globalThis.WebSocket=FakeSocket as unknown as typeof WebSocket;
 t.after(()=>{globalThis.WebSocket=originalSocket;});
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(globalThis,'fetch',async(input:string|URL|Request)=>{
  const path=new URL(String(input)).pathname;
  if(path==='/json/version')return Response.json({});
  assert.equal(path,'/json/list');
  return Response.json(['www.trodo.com','picdn.trodo.com'].map(host=>({id:host,type:'page',url:`https://${host}/`,webSocketDebuggerUrl:`ws://127.0.0.1:9222/${host}`})));
 });
 const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
 for(let batch=0;batch<2;batch++){
  let polls=0;
  const queue={async clearChallenge(){},async hostState(){return {blocked:false};},async claim(){polls++;return {waitMs:250};}} as unknown as SourceQueue;
  const collectors=startChromeCollectors(queue,{port:9222,profileDir:'unused',clientCode:'',landing:{'www.trodo.com':'https://www.trodo.com/','picdn.trodo.com':'https://picdn.trodo.com/'},log(){}});
  // Simulate hours of rate-limit waits without any source traffic or real time passing.
  for(let i=0;i<30000;i++){t.mock.timers.tick(1000);await flush();}
  assert.ok(polls>50000);
  let stopped:Promise<unknown>|undefined;
  assert.doesNotThrow(()=>{stopped=collectors.stop();});
  await stopped;
  assert.ok(sockets.every(socket=>socket.readyState===3));
 }
 assert.equal(sockets.length,4);
});
test('catalog CLI completes successive 1,000-item batches, the remainder and halts on a blocked source',{skip:!process.env.DATABASE_URL},async()=>{
 const schema='enrichment_batch_test_'+randomUUID().replaceAll('-','');
 const directory=await mkdtemp(join(tmpdir(),'enrichment-batch-'));
 const connection=new URL(process.env.DATABASE_URL!);connection.searchParams.set('options',`-c search_path=${schema}`);
 const admin=new Pool({connectionString:process.env.DATABASE_URL});
 const pool=new Pool({connectionString:connection.href});
 const startWorker=()=>{
  const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','scripts/enrichment-worker.ts','continue','0','1000'],{
   cwd:directory,env:{...process.env,DATABASE_URL:connection.href},stdio:['ignore','pipe','pipe'],timeout:30000,killSignal:'SIGKILL',
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const done=new Promise<string>((resolve,reject)=>{
   child.once('error',reject);
   child.once('close',(code,signal)=>{if(code===0)resolve(stdout);else reject(Error(`Worker exited ${code??signal}: ${stderr} ${stdout.slice(-3000)}`));});
  });
  return {child,done};
 };
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Restrict every worker query and generated artifact to this disposable fixture.
  for(const name of ['db','scripts','node_modules'])await symlink(resolve(name),join(directory,name));
  await pool.query(`CREATE TABLE supplier_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL,product_data jsonb NOT NULL,supplier text DEFAULT 'basbug',presence text DEFAULT 'present');
   CREATE TABLE products(id uuid PRIMARY KEY,brand text,part_number text,name text,merged_into uuid,updated_at timestamptz DEFAULT now());
   CREATE TABLE product_sources(supplier_item_id uuid PRIMARY KEY,product_id uuid,method text DEFAULT 'auto');
   CREATE INDEX ON product_sources(product_id);CREATE TABLE brands(id bigint PRIMARY KEY,key text,name text);CREATE TABLE supplier_brands(supplier text,label text,brand_id bigint,PRIMARY KEY(supplier,label));
   CREATE TABLE commerce_supplier_items(id uuid PRIMARY KEY,stock_data jsonb);
   CREATE TABLE vehicle_brands(id uuid PRIMARY KEY);CREATE TABLE vehicle_models(id uuid PRIMARY KEY);CREATE TABLE vehicle_types(id uuid PRIMARY KEY);`);
  const matching=await readFile('db/product-matching.sql','utf8');
  await pool.query(matching.slice(0,matching.indexOf('-- Reviewed brand decisions;')));
  await pool.query(await readFile('db/product-enrichment.sql','utf8'));
  await pool.query(await readFile('db/enrichment-worker.sql','utf8'));
  await pool.query(`INSERT INTO supplier_items(code,product_data) SELECT (1000000000+n)::text,'{"uk":"OTHER"}'::jsonb FROM generate_series(1,2001) AS n`);
  await pool.query("INSERT INTO products(id,brand,part_number) SELECT id,'OTHER',code FROM supplier_items;INSERT INTO product_sources(supplier_item_id,product_id) SELECT id,id FROM supplier_items");
  // A duplicate offer and an unlinked price-list row must never create additional source visits.
  const first=(await pool.query('SELECT id,code FROM supplier_items LIMIT 1')).rows[0];
  const duplicate=(await pool.query("INSERT INTO supplier_items(code,product_data,supplier) VALUES($1,'{\"uk\":\"OTHER\",\"marka\":\"OTHER\"}','dinamik') RETURNING id",[first.code])).rows[0].id;
  await pool.query('INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)',[duplicate,first.id]);
  await pool.query("INSERT INTO supplier_items(code,product_data) VALUES('price-only','{\"uk\":\"OTHER\"}')");
  const items=(await pool.query('SELECT code FROM supplier_items')).rows;
  const paths=[...new Set(items.flatMap(({code})=>sourcePartQueries('OTHER',code).map(searchPath)))];
  await pool.query(`INSERT INTO enrichment_source_cache(host,path,body,expires_at) SELECT 'www.trodo.com',path,'[{"products":[]}]'::jsonb,now()+interval '1 day' FROM unnest($1::text[]) AS path`,[paths]);
  const output=await startWorker().done;
  const runs=(await pool.query('SELECT id,status,sample_size FROM enrichment_runs ORDER BY created_at')).rows;
  assert.deepEqual(runs.map(r=>({status:r.status,size:r.sample_size})),[{status:'complete',size:1000},{status:'complete',size:1000},{status:'complete',size:1}]);
  assert.match(output,/"continue":"done","batches":3/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_run_items')).rows[0].n,2001);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_request_events')).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM enrichment_product_catalog WHERE status='pending'")).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(DISTINCT product_id)::int AS n FROM enrichment_run_items')).rows[0].n,2001);
  await pool.query(`INSERT INTO supplier_items(code,product_data) VALUES('2000000000','{"uk":"OTHER"}');UPDATE enrichment_source_hosts SET blocked=true WHERE host='www.trodo.com'`);
  await pool.query("INSERT INTO products(id,brand,part_number) SELECT id,'OTHER',code FROM supplier_items WHERE code='2000000000';INSERT INTO product_sources(supplier_item_id,product_id) SELECT id,id FROM supplier_items WHERE code='2000000000'");
  const halted=await startWorker().done;
  assert.match(halted,/"continue":"halted".*"status":"blocked"/);
  const blocked=(await pool.query("SELECT id FROM enrichment_runs WHERE status='blocked'")).rows[0].id;
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_runs')).rows[0].n,4);
  assert.equal((await pool.query('SELECT status FROM enrichment_run_items WHERE run_id=$1',[blocked])).rows[0].status,'queued');
  // A stop while waiting for an uncached request keeps the same batch and its checkpoint.
  await pool.query('UPDATE enrichment_source_hosts SET blocked=false');
  const worker=startWorker();
  try{
   let collecting=false;
   for(let i=0;i<100;i++){
    collecting=(await pool.query("SELECT count(*)::int AS n FROM enrichment_run_items WHERE run_id=$1 AND status='collecting'",[blocked])).rows[0].n===1;
    if(collecting)break;
    await new Promise(resolve=>setTimeout(resolve,50));
   }
   assert.ok(collecting);worker.child.kill('SIGTERM');
   assert.match(await worker.done,/"continue":"halted".*"status":"stopped"/);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_runs')).rows[0].n,4);
   assert.equal((await pool.query('SELECT status FROM enrichment_run_items WHERE run_id=$1',[blocked])).rows[0].status,'queued');
  }finally{if(worker.child.exitCode===null){worker.child.kill('SIGKILL');await worker.done.catch(()=>{});}}
 }finally{
  await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();await rm(directory,{recursive:true,force:true});
 }
});
test('cross-brand enrichment requires an original OEM row, not a similar code or aftermarket reference',()=>{
 const view=parseView([{relationships:{oe_numbers:{OPEL:[{oem:'1',value:'14 00 307'}],OTHER:[{oem:'0',value:'9999999'}]},attributes:{criteria:[]},vehicle_ids:[],vehicle_list:[]}}]);
 assert.equal(verifiedOemReference('1400307',view),'1400307');
 assert.equal(verifiedOemReference('140030',view),null);
 assert.equal(verifiedOemReference('9999999',view),null);
 assert.equal(verifiedOemReference('1111111;1400307',view),'1400307');
 assert.deepEqual(supplierOemQueries('51736774 7782831;1400307|1400307'),['51736774','7782831','1400307']);assert.deepEqual(supplierOemQueries('HX7G 6065 AB/SET'),['HX7G 6065 AB/SET','HX7G 6065 AB']);assert.deepEqual(supplierOemQueries('.'),[]);
});
test('Hengst supplier identity matches the source while similar search results stay rejected',()=>{
 const product={entity_id:677213,manufacturer:'HENGST FILTER',tecdoc_sku:'E700L'};
 assert.deepEqual(sourcePartQueries('HENGST','HNG E700L'),['E700L','HENGST E700L']);
 assert.equal(chooseExact('HENGST','HNG E700L',[product]),product);
 assert.equal(chooseExact('HENGST','HNG E700L',[{...product,tecdoc_sku:'E1002L'}]),null);
 assert.equal(chooseExact('HENGST','HNG E700L',[{...product,manufacturer:'FILTRON'}]),null);
 assert.equal(chooseExact('HENGST','XYZ E700L',[product]),null);
 assert.equal(chooseExact('HENGST','HNG E700L',[product,{...product,entity_id:999}]),null);
 assert.deepEqual(sourcePartQueries('OTHER','ABC 104620'),['ABC 104620','104620','OTHER 104620']);assert.deepEqual(sourcePartQueries('GLASER','GLS T85010-00'),['GLS T85010-00','T85010-00','T8501000','GLASER T85010-00']);
 assert.deepEqual(sourcePartQueries('BOSCH','BCH F 026 400 093'),['F 026 400 093','F026400093','BOSCH F 026 400 093']);
});
test('rate limiting honors both Retry-After forms and opens a circuit after bounded retries',()=>{
 assert.equal(retryAfterMs('120'),120000);assert.equal(retryAfterMs('Sun, 04 Oct 2026 10:02:00 GMT',Date.parse('2026-10-04T10:00:00Z')),120000);
 assert.deepEqual(sourceDecision(429,1,'180'),{action:'retry',waitMs:180000});assert.equal(sourceDecision(429,4,null).action,'block');assert.equal(sourceDecision(403,1,null).action,'block');assert.equal(sourceDecision(404,1,null).action,'fail');assert.equal(sourceDecision(403,4,null,Date.now(),true).action,'challenge');assert.equal(sourceDecision(404,1,null,Date.now(),true).action,'fail');
});
test('browser tasks reject third-party hosts, account endpoints and protocol-relative paths',()=>{
 assert.equal(validSourcePath('www.trodo.com','/rest/V1/customers/me','json'),false);assert.equal(validSourcePath('www.trodo.com','//evil.example/x','html'),false);assert.equal(validSourcePath('evil.example','/rest/V1/vehicle/type/1/23','json'),false);assert.equal(validSourcePath('www.trodo.com','/rest/V1/vehicle/type/1/23','json'),true);
 assert.ok(oemSearchPath('H1BC 1125 A1A').startsWith('/rest/V1/catalogsearch/oem/H1BC1125A1A?'));assert.equal(validSourcePath('www.trodo.com',oemSearchPath('H1BC 1125 A1A'),'json'),true);assert.equal(validSourcePath('www.trodo.com',searchPath('1676014280'),'json'),true);assert.equal(validSourcePath('www.trodo.com','/rest/V1/catalogsearch/oem/../customers?','json'),false);
});
test('search results without source images remain identifiable but cannot supply an image',()=>{
 const raw={entity_id:123,manufacturer:'BOSCH',tecdoc_sku:'F026400093',media:{src:null}};
 const product=parseSearch([{products:[raw]}]).products[0];
 assert.equal(chooseExact('BOSCH','BCH F026400093',[product]),product);
 assert.equal(imagePath(product),null);
 assert.throws(()=>parseSearch([{products:[{...raw,manufacturer:null}]}]));
});
test('OEM candidates can identify the exact supplier part without copying a different brand',()=>{
 const hart={entity_id:2400365,manufacturer:'HART',tecdoc_sku:'926 186'};
 const filtron={entity_id:1099142,manufacturer:'FILTRON',tecdoc_sku:'OE 672/10'};
 const products=parseSearch([{products:[hart,filtron]}]).products;
 assert.equal(sourcePartQuery('FILTRON','FILT OE 672/10'),'OE 672/10');
 assert.equal(chooseExact('FILTRON','FILT OE 672/10',products)?.entity_id,1099142);
 assert.equal(chooseExact('FILTRON','FILT OE 672/10',[products[0]]),null);
 assert.equal(chooseExact('FILTRON','FILT OE 672/10',[...products,{...products[1],entity_id:'1099142'}])?.entity_id,'1099142');
 assert.equal(chooseExact('FILTRON','FILT OE 672/10',[...products,{...products[1],entity_id:999}]),null);
});
test('real source fixtures preserve exact identity and explicitly empty vehicle coverage',async()=>{
 const rows=JSON.parse(await readFile('tests/fixtures/core-results.json','utf8')).rows;
 for(const row of rows){parseProduct([{attributes:row.product}]);parseView([{relationships:row.view}]);}
 assert.equal(sourcePartQuery('BOSCH','BCH F026400093'),'F026400093');assert.equal(sourcePartQuery('OTHER','ABC 104620'),'ABC 104620');
 const product=parseProduct([{attributes:rows[0].product}]);assert.equal(chooseExact('OTHER','104620',[product]),null);
 const empty=parseView([{relationships:rows[6].view}]);assert.equal(empty.vehicle_ids.length,0);assert.deepEqual(await collectVehicles({get(){throw Error('Empty coverage must not fetch')}} as unknown as SourceQueue,empty),{vehicles:[],vehicleModels:[],coverage:{expected:0,covered:0,unresolved:[],invalid:[]}});
});
test('malformed vehicle dates do not become complete observations and electric cc0 remains valid',()=>{
 const seed={value:'123',label:{name:'EV',kw_ps:'100kW/136PS',ccm:'0ccm',engine_fuel:'Electric',year:'01/2020-0/0'}};
 assert.equal(parseEngine('TEST MODEL',seed).cc,0);assert.throws(()=>parseEngine('TEST MODEL',{...seed,label:{...seed.label,year:'0/0-0/0'}}));assert.throws(()=>parseEngine('TEST MODEL',{...seed,label:{...seed.label,engine_fuel:'Petrol'}}));
});
test('pacing adds random jitter and holds requests through a nightly Istanbul window',()=>{
 assert.equal(pacingDelayMs(7000,4000,()=>0),7000);
 assert.equal(pacingDelayMs(7000,4000,()=>0.999),10996);
 assert.equal(pacingDelayMs(7000,0,()=>0.5),7000);
 // Istanbul is UTC+3: 23:30 UTC is 02:30 local.
 const at=(utc:string)=>Date.parse(utc);
 assert.equal(quietWaitMs(at('2026-10-12T23:30:00Z'),2,7),270*60000);
 assert.equal(quietWaitMs(at('2026-10-12T23:30:00Z'),null,7),0);
 assert.equal(quietWaitMs(at('2026-10-12T23:30:00Z'),3,3),0);
 assert.equal(quietWaitMs(at('2026-10-13T04:00:00Z'),2,7),0);
 assert.equal(quietWaitMs(at('2026-10-12T22:59:30Z'),2,7),0);
 // A window across midnight: 23:00-06:00 local.
 assert.equal(quietWaitMs(at('2026-10-12T20:15:00Z'),23,6),(6*60+45)*60000);
 assert.equal(quietWaitMs(at('2026-10-12T02:59:59Z'),23,6),1000);
 assert.equal(quietWaitMs(at('2026-10-12T12:00:00Z'),23,6),0);
});
test('durable request leases, restart recovery, stale acknowledgement and 429 never mark a cache miss not-found',{skip:!process.env.DATABASE_URL},async()=>{
 const schema='enrichment_test_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
 try{
  for(const name of ['enrichment_runs','enrichment_source_hosts','enrichment_source_cache','enrichment_source_requests','enrichment_request_events'])await pool.query(`CREATE TABLE ${schema}.${name}(LIKE public.${name} INCLUDING ALL)`);
  const run=(await pool.query("INSERT INTO enrichment_runs(seed,sample_size) VALUES('test',1) RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO enrichment_source_hosts(host) VALUES('www.trodo.com')");
  const queue=new SourceQueue(pool,run),path='/rest/V1/vehicle/type/1/123';
  await pool.query("INSERT INTO enrichment_source_requests(run_id,host,path,kind) VALUES($1,'www.trodo.com',$2,'json')",[run,path]);
  const first=await queue.claim('www.trodo.com');assert.ok('id' in first);
  const concurrent=await queue.claim('www.trodo.com');assert.ok('waitMs' in concurrent);
  await pool.query("UPDATE enrichment_source_requests SET lease_until=now()-interval '1 second';UPDATE enrichment_source_hosts SET next_allowed_at=now()");
  const recovered=await queue.claim('www.trodo.com');assert.ok('id' in recovered);if(!('id' in first)||!('id' in recovered))throw Error('Lease missing');assert.notEqual(first.token,recovered.token);
  await assert.rejects(()=>queue.finish({id:first.id,token:first.token,httpStatus:200,elapsedMs:10,bytes:1,retryAfter:null,body:[{}]}),/Stale/);
  await queue.finish({id:recovered.id,token:recovered.token,httpStatus:429,elapsedMs:10,bytes:0,retryAfter:'300'});
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM enrichment_source_cache')).rows[0].count,0);
  assert.equal((await pool.query('SELECT status FROM enrichment_source_requests')).rows[0].status,'pending');
  assert.equal((await pool.query('SELECT interval_ms FROM enrichment_source_hosts')).rows[0].interval_ms,5000);
  assert.ok((await queue.claim('www.trodo.com')));
  // A quiet window covering every hour of the day holds the queue; jitter lengthens the gap after a claim.
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hourCycle:'h23',hour:'numeric'}).format(Date.now()));
  await pool.query('UPDATE enrichment_source_requests SET available_at=now()');
  await pool.query('UPDATE enrichment_source_hosts SET next_allowed_at=now(),interval_ms=7000,jitter_ms=4000,quiet_start_hour=$1,quiet_end_hour=$2',[hour,(hour+1)%24]);
  const quiet=await queue.claim('www.trodo.com');assert.ok('waitMs' in quiet&&quiet.waitMs>0&&quiet.waitMs<=3600000);
  await pool.query('UPDATE enrichment_source_hosts SET quiet_start_hour=NULL,quiet_end_hour=NULL');
  const paced=await queue.claim('www.trodo.com');if(!('id' in paced))throw Error('Lease missing');
  const gap=(await pool.query("SELECT extract(epoch FROM next_allowed_at-now())*1000 AS ms FROM enrichment_source_hosts")).rows[0].ms;
  assert.ok(gap>6000&&gap<11000,`gap ${gap}`);
  await pool.query("UPDATE enrichment_source_requests SET status='pending',lease_token=NULL,available_at=now();UPDATE enrichment_source_hosts SET next_allowed_at=now()");
  const last=await queue.claim('www.trodo.com');if(!('id' in last))throw Error('Lease missing');
  await queue.finish({id:last.id,token:last.token,httpStatus:200,elapsedMs:10,bytes:10,retryAfter:null,body:[{valid:true}]});
  assert.deepEqual(await new SourceQueue(pool,run).get('www.trodo.com',path),[{valid:true}]);
  assert.equal((await pool.query('SELECT cache_hits FROM enrichment_runs')).rows[0].cache_hits,1);
  // A view-data response captured from a product page is served from cache without queuing a request.
  const view='/rest/V1/catalog-product-api/view-data/42/IE';
  await queue.store('www.trodo.com',view,'json',{relationships:[]});
  assert.deepEqual(await queue.get('www.trodo.com',view),{relationships:[]});
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM enrichment_source_requests WHERE path=$1',[view])).rows[0].count,0);
  await assert.rejects(()=>queue.store('www.trodo.com','/customer/account','json',{}),/rejected/);
  // unblock reopens the circuit and returns the tripping request of an unfinished run to the queue; finished runs keep history.
  const done=(await pool.query("INSERT INTO enrichment_runs(seed,sample_size,status) VALUES('done',1,'complete') RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO enrichment_source_requests(run_id,host,path,kind,status,attempts,last_error) VALUES($1,'www.trodo.com','/a','html','blocked',1,'HTTP 403'),($2,'www.trodo.com','/b','html','blocked',1,'HTTP 403')",[run,done]);
  await pool.query("UPDATE enrichment_runs SET status='blocked' WHERE id=$1",[run]);
  await pool.query("UPDATE enrichment_source_hosts SET blocked=true,last_error='HTTP 403'");
  assert.deepEqual(await unblockSources(pool),{hosts:1,requests:1});
  assert.deepEqual((await pool.query("SELECT path,status,attempts FROM enrichment_source_requests WHERE path IN ('/a','/b') ORDER BY path")).rows,[{path:'/a',status:'pending',attempts:0},{path:'/b',status:'blocked',attempts:1}]);
  assert.equal((await pool.query('SELECT blocked FROM enrichment_source_hosts')).rows[0].blocked,false);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});

test('catalog matcher cache is reused only while the catalog revision stays unchanged',{skip:!process.env.DATABASE_URL},async()=>{
 const {createMatcherCache}=await import('../src/modules/enrichment/matcher-cache');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("CREATE TEMP TABLE vehicle_catalog_revision(id boolean PRIMARY KEY,revision bigint) ON COMMIT DROP");await client.query('INSERT INTO vehicle_catalog_revision VALUES(true,1)');
  const cached=createMatcherCache(),first=await cached(client);assert.equal(await cached(client),first);
  await client.query('UPDATE vehicle_catalog_revision SET revision=2');assert.notEqual(await cached(client),first);
 }finally{await client.query('ROLLBACK');client.release();await pool.end();}
});

test('Cloudflare challenge pauses the host without spending attempts and resumes the same request',{skip:!process.env.DATABASE_URL},async()=>{
 const schema='enrichment_test_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
 try{
  for(const name of ['enrichment_runs','enrichment_source_hosts','enrichment_source_cache','enrichment_source_requests','enrichment_request_events'])await pool.query(`CREATE TABLE ${schema}.${name}(LIKE public.${name} INCLUDING ALL)`);
  const run=(await pool.query("INSERT INTO enrichment_runs(seed,sample_size) VALUES('test',1) RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO enrichment_source_hosts(host) VALUES('www.trodo.com')");
  const queue=new SourceQueue(pool,run);
  await pool.query("INSERT INTO enrichment_source_requests(run_id,host,path,kind) VALUES($1,'www.trodo.com','/rest/V1/vehicle/type/1/1','json')",[run]);
  for(let i=0;i<5;i++){
   await pool.query('UPDATE enrichment_source_hosts SET next_allowed_at=now()');
   const job=await queue.claim('www.trodo.com');if(!('id' in job))throw Error('Lease missing');
   assert.equal((await queue.finish({id:job.id,token:job.token,httpStatus:403,elapsedMs:5,bytes:0,retryAfter:null,challenge:true})).action,'challenge');
   assert.ok('challenge' in await queue.claim('www.trodo.com'));
   await queue.clearChallenge('www.trodo.com');
  }
  const row=(await pool.query('SELECT status,attempts FROM enrichment_source_requests')).rows[0];assert.deepEqual(row,{status:'pending',attempts:0});
  const host=(await pool.query('SELECT blocked,challenges FROM enrichment_source_hosts')).rows[0];assert.deepEqual(host,{blocked:false,challenges:5});
  await pool.query('UPDATE enrichment_source_hosts SET next_allowed_at=now()');
  const job=await queue.claim('www.trodo.com');if(!('id' in job))throw Error('Lease missing');
  await queue.release(job.id,job.token);
  assert.deepEqual((await pool.query('SELECT status,attempts FROM enrichment_source_requests')).rows[0],{status:'pending',attempts:0});
  await pool.query('UPDATE enrichment_source_hosts SET next_allowed_at=now()');
  const final=await queue.claim('www.trodo.com');if(!('id' in final))throw Error('Lease missing');
  await queue.finish({id:final.id,token:final.token,httpStatus:200,elapsedMs:5,bytes:2,retryAfter:null,body:[{ok:true}]});
  assert.deepEqual(await queue.get('www.trodo.com','/rest/V1/vehicle/type/1/1'),[{ok:true}]);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});


test('master product sharing excludes equivalents, split offers and changed supplier identities', {skip:!process.env.DATABASE_URL}, async()=>{
 const {reconcileProductQueue}=await import('../src/modules/enrichment/product-queue');
 const schema='enrichment_products_test_'+randomUUID().replaceAll('-','');
 const connection=new URL(process.env.DATABASE_URL!);connection.searchParams.set('options',`-c search_path=${schema}`);
 const admin=new Pool({connectionString:process.env.DATABASE_URL});
 const pool=new Pool({connectionString:connection.href});
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE supplier_items(id uuid PRIMARY KEY,code text,product_data jsonb,supplier text,presence text DEFAULT 'present');
   CREATE TABLE products(id uuid PRIMARY KEY,brand text,part_number text,name text,merged_into uuid,updated_at timestamptz DEFAULT now());
   CREATE TABLE product_sources(supplier_item_id uuid PRIMARY KEY,product_id uuid,method text DEFAULT 'auto');
   CREATE TABLE brands(id bigint PRIMARY KEY,key text,name text);CREATE TABLE supplier_brands(supplier text,label text,brand_id bigint,PRIMARY KEY(supplier,label));
   CREATE TABLE vehicle_brands(id uuid PRIMARY KEY);CREATE TABLE vehicle_models(id uuid PRIMARY KEY);CREATE TABLE vehicle_types(id uuid PRIMARY KEY);`);
  const matching=await readFile('db/product-matching.sql','utf8');
  await pool.query(matching.slice(0,matching.indexOf('-- Reviewed brand decisions;')));
  for(const file of ['product-enrichment','enrichment-worker','enrichment-products'])await pool.query(await readFile(`db/${file}.sql`,'utf8'));
  const donor=randomUUID(),target=randomUUID(),equivalent=randomUUID(),pending=randomUUID(),duplicate=randomUUID(),unlinked=randomUUID();
  await pool.query(`INSERT INTO supplier_items(id,code,product_data,supplier) VALUES
   ($1,'FEBI 181123','{"uk":"FEBI","oe":"12345678"}','basbug'),
   ($2,'FEBI 181123','{"marka":"FEBI"}','dinamik'),
   ($3,'BOS 181123','{"uk":"BOSCH"}','basbug'),
   ($4,'FEBI 222222','{"uk":"FEBI"}','basbug'),
   ($5,'FEBI 222222','{"uk":"FEBI","marka":"FEBI"}','dinamik'),
   ($6,'price-only','{"uk":"OTHER"}','dinamik')`,[donor,target,equivalent,pending,duplicate,unlinked]);
  await pool.query(`INSERT INTO products(id,brand,part_number) VALUES($1,'FEBI','181123'),($2,'BOSCH','181123'),($3,'FEBI','222222')`,[donor,equivalent,pending]);
  await pool.query('INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1),($4,$1),($2,$2),($3,$3),($5,$3)',[donor,equivalent,pending,target,duplicate]);
  await pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status)
   SELECT id,code,COALESCE(product_data->>'uk',product_data->>'marka',''),CASE WHEN id=$1 THEN 'complete' ELSE 'pending' END FROM supplier_items`,[donor]);
  await pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
   VALUES($1,'FEBI 181123','FEBI','https://www.trodo.com/febi-181123','test','FEBI BILSTEIN','181123','{"vehicles":[],"specifications":[],"oemNumbers":{}}')`,[donor]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_product_catalog')).rows[0].n,3);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM enrichment_product_catalog WHERE status='pending'")).rows[0].n,2);
  const shared=(await pool.query('SELECT supplier_item_id,donor_item_id FROM product_enrichment_shared ORDER BY supplier_item_id')).rows;
  assert.deepEqual(new Set(shared.map(row=>row.supplier_item_id)),new Set([donor,target]));
  assert.ok(shared.every(row=>row.donor_item_id===donor));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_enrichments')).rows[0].n,1);
  // Preserve an interrupted product's checkpoint; duplicate offers and unlinked price rows become history.
  const run=(await pool.query("INSERT INTO enrichment_runs(seed,sample_size) VALUES('test',3) RETURNING id")).rows[0].id;
  await pool.query(`INSERT INTO enrichment_run_items(run_id,supplier_item_id,ordinal,supplier_code,supplier_brand,oem,stage,checkpoint)
   SELECT $1,id,row_number() OVER(ORDER BY id)-1,code,'FEBI','',CASE WHEN id=$2 THEN 'vehicles' ELSE 'search' END,
    CASE WHEN id=$2 THEN '{"saved":true}'::jsonb ELSE '{}'::jsonb END FROM supplier_items WHERE id=ANY($3::uuid[])`,[run,pending,[pending,duplicate,unlinked]]);
  assert.equal(await reconcileProductQueue(pool,run),2);
  const saved=(await pool.query('SELECT status,stage,checkpoint FROM enrichment_run_items WHERE run_id=$1 AND supplier_item_id=$2',[run,pending])).rows[0];
  assert.deepEqual(saved,{status:'queued',stage:'vehicles',checkpoint:{saved:true}});
  // A reviewed split immediately removes shared data from the separated offer.
  await pool.query("INSERT INTO products(id,brand,part_number) VALUES($1,'FEBI','181123')",[target]);
  await pool.query("UPDATE product_sources SET product_id=$1,method='manual' WHERE supplier_item_id=$1",[target]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_enrichment_shared WHERE supplier_item_id=$1',[target])).rows[0].n,0);
  // Automatic targets must still match the catalog key even before the next matching refresh.
  await pool.query("UPDATE product_sources SET product_id=$1,method='auto' WHERE supplier_item_id=$2",[donor,target]);
  await pool.query("UPDATE supplier_items SET code='FEBI 999999' WHERE id=$1",[target]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_enrichment_shared WHERE supplier_item_id=$1',[target])).rows[0].n,0);
  // A changed donor identity invalidates both shared access and the complete queue outcome.
  await pool.query("UPDATE supplier_items SET code='FEBI 999998' WHERE id=$1",[donor]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_enrichment_shared')).rows[0].n,0);
  await pool.query("UPDATE supplier_items SET code='FEBI 181123' WHERE id=$1",[donor]);
  await pool.query('UPDATE product_enrichments SET match_basis=$2 WHERE supplier_item_id=$1',[donor,JSON.stringify({type:'oem_reference',supplierOem:'12345678'})]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_valid_data')).rows[0].n,1);
  await pool.query("UPDATE supplier_items SET product_data=jsonb_set(product_data,'{oe}','\"87654321\"') WHERE id=$1",[donor]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_valid_data')).rows[0].n,0);
  assert.equal((await pool.query('SELECT status FROM enrichment_product_catalog WHERE product_id=$1',[donor])).rows[0].status,'pending');
 } finally {await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
