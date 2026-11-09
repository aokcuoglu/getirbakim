import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {chooseExact,parseSearch} from '../src/modules/enrichment/trodo-adapter';
import {supplierPartKeys,searchProductRows,recordSearchProducts,knownSearchProducts} from '../src/modules/enrichment/search-products';
import {partKey,manufacturerBrandKey} from '../src/modules/store/enrichment-contract';
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
  for(const value of ['GDB3368','0 986 494 123','00','ap 034/2','FEBI','Mann','HENGST FILTER','febi bilstein']){
   const sql=(await pool.query('SELECT enrichment_part_key($1) AS part,enrichment_brand_key($1) AS brand',[value])).rows[0];
   assert.deepEqual(sql,{part:partKey(value),brand:manufacturerBrandKey(value)},value);
  }
 }finally{await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
