import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {sourceDecision,retryAfterMs,validSourcePath} from '../src/modules/enrichment/policy';
import {parseProduct,parseSearch,parseView,parseEngine,chooseExact,sourcePartQuery,collectVehicles,imagePath} from '../src/modules/enrichment/trodo-adapter';
import {SourceQueue} from '../src/modules/enrichment/source-queue';
test('rate limiting honors both Retry-After forms and opens a circuit after bounded retries',()=>{
 assert.equal(retryAfterMs('120'),120000);assert.equal(retryAfterMs('Sun, 04 Oct 2026 10:02:00 GMT',Date.parse('2026-10-04T10:00:00Z')),120000);
 assert.deepEqual(sourceDecision(429,1,'180'),{action:'retry',waitMs:180000});assert.equal(sourceDecision(429,4,null).action,'block');assert.equal(sourceDecision(403,1,null).action,'block');assert.equal(sourceDecision(404,1,null).action,'fail');
});
test('browser tasks reject third-party hosts, account endpoints and protocol-relative paths',()=>{
 assert.equal(validSourcePath('www.trodo.com','/rest/V1/customers/me','json'),false);assert.equal(validSourcePath('www.trodo.com','//evil.example/x','html'),false);assert.equal(validSourcePath('evil.example','/rest/V1/vehicle/type/1/23','json'),false);assert.equal(validSourcePath('www.trodo.com','/rest/V1/vehicle/type/1/23','json'),true);
});
test('search results without source images remain identifiable but cannot supply an image',()=>{
 const raw={entity_id:123,manufacturer:'BOSCH',tecdoc_sku:'F026400093',media:{src:null}};
 const product=parseSearch([{products:[raw]}]).products[0];
 assert.equal(chooseExact('BOSCH','BCH F026400093',[product]),product);
 assert.equal(imagePath(product),null);
 assert.throws(()=>parseSearch([{products:[{...raw,manufacturer:null}]}]));
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
  await pool.query("UPDATE enrichment_source_requests SET available_at=now();UPDATE enrichment_source_hosts SET next_allowed_at=now()");
  const last=await queue.claim('www.trodo.com');if(!('id' in last))throw Error('Lease missing');
  await queue.finish({id:last.id,token:last.token,httpStatus:200,elapsedMs:10,bytes:10,retryAfter:null,body:[{valid:true}]});
  assert.deepEqual(await new SourceQueue(pool,run).get('www.trodo.com',path),[{valid:true}]);
  assert.equal((await pool.query('SELECT cache_hits FROM enrichment_runs')).rows[0].cache_hits,1);
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
