import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {chooseExact,parseSearch,sourcePartQuery,sourcePartQueries} from '../src/modules/enrichment/trodo-adapter';
import {requireEnrichmentSchema} from '../src/modules/enrichment/schema';
import {supplierPartKeys,searchProductRows,recordSearchProducts,knownSearchProducts} from '../src/modules/enrichment/search-products';
import {partKey,manufacturerBrandKey,manufacturerBrandAliases} from '../src/modules/store/enrichment-contract';
const reinz=parseSearch([{products:[{entity_id:21,manufacturer:'REINZ',tecdoc_sku:'61-36960-00',url_key:'gasket-reinz-61-36960-00'}]}]).products;
const search=parseSearch([{products:[
 {entity_id:11,manufacturer:'TRW',tecdoc_sku:'GDB3368',url_key:'brake-pad-set-disc-brake-trw-gdb3368',category:[{category_id:268,name:'Brake pads'}],price:12.5},
 {entity_id:12,manufacturer:'FEBI BILSTEIN',tecdoc_sku:'02562',url_key:'seal-febi-bilstein-02562'},
 {entity_id:13,manufacturer:'BOSCH',tecdoc_sku:'0 986 494 123',url_key:'Bad Slug'},
]}]);
test('supplier codes are keyed by the whole code and by the code after a brand prefix',()=>{
 assert.deepEqual(supplierPartKeys('TRW GDB3368'),['TRWGDB3368','GDB3368']);
 assert.deepEqual(supplierPartKeys('FEBI 2562'),['FEBI2562','2562']);
 assert.deepEqual(supplierPartKeys('442-2035L-UQ'),['4422035LUQ']);
});
test('a multi-word brand prefix is keyed by every suffix and the master brand can identify the part (#1117)',()=>{
 assert.deepEqual(supplierPartKeys('VICTOR REINZ 61-36960-00'),['VICTORREINZ613696000','REINZ613696000','613696000']);
 assert.equal(chooseExact('VICTOR REINZ','VICTOR REINZ 61-36960-00',reinz)?.entity_id,21);
 // A supplier label that is not the manufacturer's name only matches through its reviewed master brand.
 assert.equal(chooseExact('VICTOR REINZ-AV','VICTOR REINZ 61-36960-00',reinz),null);
 assert.equal(chooseExact('VICTOR REINZ-AV','VICTOR REINZ 61-36960-00',reinz,'VICTOR REINZ')?.entity_id,21);
});
test('search queries strip the label or the master brand prefix, whichever names the code (#1117)',()=>{
 // The label's own name prefixes the code; the master brand (ORIJINAL) does not.
 assert.equal(sourcePartQuery('ITHAL','ITHAL 03C103601BH','ORIJINAL'),'03C103601BH');
 assert.equal(sourcePartQueries('ITHAL','ITHAL 03C103601BH','ORIJINAL')[0],'03C103601BH');
 // The master brand's name prefixes the code; the label (BOSCH-AV) does not.
 assert.equal(sourcePartQuery('BOSCH-AV','BOSCH 1987949631','BOSCH'),'1987949631');
 assert.equal(sourcePartQuery('BOSCH-AV','BOSCH 1987949631'),'BOSCH 1987949631');
 assert.equal(sourcePartQuery('VICTOR REINZ-AV','VICTOR REINZ 61-36960-00','VICTOR REINZ'),'61-36960-00');
 // The search by name still uses the supplier label, as before.
 assert.ok(sourcePartQueries('BOSCH-AV','BOSCH 1987949631','BOSCH').includes('BOSCH-AV 1987949631'));
});
test('only openable search products are kept, with the fields the worker reads',()=>{
 const rows=searchProductRows(search.products);
 assert.deepEqual(rows.map(r=>[r.partKey,r.entityId,r.brandKey]),[['GDB3368','11','TRW'],['2562','12','FEBIBILSTEIN']]);
 assert.equal('price' in rows[0].product,false);
 assert.deepEqual(rows[0].product.category,[{category_id:268,name:'Brake pads'}]);
});
test('a kept product still has to be the exact supplier part to be used',()=>{
 const products=search.products.slice(0,2);
 assert.equal(chooseExact('TRW','TRW GDB3368',products)?.entity_id,11);
 assert.equal(chooseExact('FEBI','FEBI 2562',products)?.entity_id,12);
 // Same number, other brand: listed under the key but never chosen.
 assert.equal(chooseExact('TEXTAR','GDB3368',products),null);
});
test('search products round-trip through the database and SQL keys order batches like the contract',{skip:!process.env.DATABASE_URL},async()=>{
 const schema='enrichment_search_test_'+randomUUID().replaceAll('-','');
 const connection=new URL(process.env.DATABASE_URL!);connection.searchParams.set('options',`-c search_path=${schema}`);
 const admin=new Pool({connectionString:process.env.DATABASE_URL}),pool=new Pool({connectionString:connection.href});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query('CREATE TABLE supplier_items(id uuid PRIMARY KEY);CREATE TABLE vehicle_brands(id uuid PRIMARY KEY);CREATE TABLE vehicle_models(id uuid PRIMARY KEY);CREATE TABLE vehicle_types(id uuid PRIMARY KEY);');
  await pool.query(await readFile('db/enrichment-worker.sql','utf8'));
  await recordSearchProducts(pool,search.products);
  await recordSearchProducts(pool,search.products);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enrichment_search_products')).rows[0].n,2);
  assert.deepEqual((await knownSearchProducts(pool,'TRW GDB3368')).map(p=>p.entity_id),[11]);
  assert.deepEqual((await knownSearchProducts(pool,'FEBI 02562')).map(p=>p.entity_id),[12]);
  assert.deepEqual(await knownSearchProducts(pool,'NOPE 1'),[]);
  await recordSearchProducts(pool,reinz);
  assert.deepEqual((await knownSearchProducts(pool,'VICTOR REINZ 61-36960-00')).map(p=>p.entity_id),[21]);
  for(const code of ['VICTOR REINZ 61-36960-00','TRW GDB3368','FEBI 02562','442-2035L-UQ','BCH F 026 400 093','  TRW   GDB3368 ','0 0','',' ','LEMFÖRDER 12345 01','LÖBRO 304-123','HÜCO 13 0001']){
   const sql=(await pool.query('SELECT enrichment_supplier_part_keys($1) AS keys',[code])).rows[0].keys as string[];
   assert.deepEqual([...sql].sort(),[...supplierPartKeys(code)].sort(),code);
  }
  // createRun keeps the cheaper inline keys for codes of one or two words; they must be the same key set.
  const listedKeys=`SELECT CASE WHEN btrim(c) ~ '[^[:space:]][[:space:]]+[^[:space:]]+[[:space:]]' THEN enrichment_supplier_part_keys(c)
   ELSE ARRAY[enrichment_part_key(c),enrichment_part_key(substring(btrim(c) from '[[:space:]]+(.+)$'))] END AS inline,enrichment_supplier_part_keys(c) AS keys FROM (SELECT $1::text AS c) s`;
  for(const code of ['GDB3368','TRW GDB3368','FEBI 02562',' FEBI   02562 ','00 0','0','A-B','VICTOR REINZ 61-36960-00','BCH F 026 400 093','LEMFÖRDER 12345 01','LÖBRO 304-123','HÜCO 13 0001']){
   const {inline,keys}=(await pool.query(listedKeys,[code])).rows[0] as {inline:(string|null)[];keys:string[]};
   assert.deepEqual([...new Set(inline.filter((k):k is string=>Boolean(k)))].sort(),[...keys].sort(),code);
  }
  await requireEnrichmentSchema(pool,['enrichment_search_products'],['enrichment_supplier_part_keys(text)']);
  await assert.rejects(requireEnrichmentSchema(pool,['enrichment_search_products'],['enrichment_missing_function(text)']),/enrichment_missing_function\(text\): run npm run db:setup/);
  // Rows stored under the old REINZ brand key are rewritten by a re-run of the schema file.
  await pool.query("UPDATE enrichment_search_products SET brand_key='REINZ' WHERE entity_id='21'");
  await pool.query(await readFile('db/enrichment-worker.sql','utf8'));
  assert.equal((await pool.query("SELECT brand_key FROM enrichment_search_products WHERE entity_id='21'")).rows[0].brand_key,'VICTORREINZ');
  // Keys stored before the diacritic fold (#1139) are recomputed from the stored manufacturer, and a second re-run
  // writes nothing.
  await pool.query(`UPDATE enrichment_search_products SET brand_key='LEMFRDER',product=jsonb_set(product,'{manufacturer}','"LEMFÖRDER"') WHERE entity_id='11'`);
  await pool.query(await readFile('db/enrichment-worker.sql','utf8'));
  const folded=(await pool.query("SELECT brand_key,xmin::text AS xmin FROM enrichment_search_products WHERE entity_id='11'")).rows[0];
  assert.equal(folded.brand_key,'LEMFORDER');
  await pool.query(await readFile('db/enrichment-worker.sql','utf8'));
  assert.equal((await pool.query("SELECT xmin::text AS xmin FROM enrichment_search_products WHERE entity_id='11'")).rows[0].xmin,folded.xmin);
  for(const value of ['GDB3368','0 986 494 123','00','ap 034/2','FEBI','Mann','HENGST FILTER','febi bilstein','REINZ','Victor Reinz',
   'LEMFÖRDER','lemförder','LÖBRO','HÜCO','LESJÖFORS','AKRON-MALÒ','EBERSPÄCHER','NÜRAL','LUBRİCO','KRAFTVOLL SENSÖR AV',
   'İstanbul ısı','Şş Ğğ Çç Öö Üü İı','Citroën','Peugeot Société','Straße','Æ Ø Ł','ﬁlter','0０1²',
   'Schaeffler INA','SCHAEFFLER LuK','Schaeffler FAG','AVA Clever Choice','BorgWarner (BERU)','VDO Continental','ams-OSRAM',
   '000','0','007','0A01','00 7-0',
   // Every alias of the contract, so one added on a single side fails here.
   ...Object.keys(manufacturerBrandAliases),...Object.keys(manufacturerBrandAliases).map(k=>k.toLowerCase())]){
   const sql=(await pool.query('SELECT enrichment_part_key($1) AS part,enrichment_brand_key($1) AS brand',[value])).rows[0];
   assert.deepEqual(sql,{part:partKey(value),brand:manufacturerBrandKey(value)},value);
  }
  // Every BMP code point but the surrogates (and NUL, which text cannot hold) folds like normalize() in the contract.
  const probes=[[0x1,0xd7ff],[0xe000,0xffff]].flatMap(([from,to])=>
   Array.from({length:to-from+1},(_,i)=>'a'+String.fromCodePoint(from+i)+'1'));
  const swept=(await pool.query('SELECT enrichment_part_key(v) AS k FROM unnest($1::text[]) WITH ORDINALITY AS t(v,n) ORDER BY n',[probes])).rows.map(r=>r.k as string);
  assert.deepEqual(swept,probes.map(partKey));
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
