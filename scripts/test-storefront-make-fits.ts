import test from 'node:test';
import { syncSharedLinks } from "./test-helpers/shared-links";
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

// The make and model lists the storefront reads (#455, #639) must equal the live computation after every write path,
// with the admin's added and removed types (#583) applied per offer and type.
const liveFor=(types:string)=>`WITH types AS MATERIALIZED (${types}),
 fits AS MATERIALIZED (SELECT f.supplier_item_id,f.source_index,f.source_vehicle,f.vehicle_type_id FROM types JOIN product_vehicle_fitments f ON f.vehicle_type_id=types.id),
 trusted AS MATERIALIZED (SELECT e.supplier_item_id,e.donor_item_id,e.payload->'vehicles' AS vehicles FROM product_enrichment_shared e
  JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
  AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
  WHERE e.donor_item_id IN (SELECT supplier_item_id FROM fits)),
 decided AS MATERIALIZED (SELECT ps.supplier_item_id,o.vehicle_type_id,o.mode FROM types
  JOIN product_override_fitments o ON o.vehicle_type_id=types.id JOIN product_sources ps ON ps.product_id=o.product_id)
 SELECT t.supplier_item_id::text AS id FROM fits f JOIN trusted t ON t.donor_item_id=f.supplier_item_id AND f.source_vehicle=t.vehicles->f.source_index
  WHERE NOT EXISTS (SELECT 1 FROM decided d WHERE d.mode='remove' AND d.supplier_item_id=t.supplier_item_id AND d.vehicle_type_id=f.vehicle_type_id)
 UNION SELECT supplier_item_id::text FROM decided WHERE mode='add'`;
const live=liveFor('SELECT v.id FROM vehicle_types v JOIN vehicle_models m ON m.id=v.model_id WHERE m.brand_id=$1');
const liveModel=liveFor('SELECT v.id FROM vehicle_types v WHERE v.model_id=$1');

test('storefront make and model lists follow payloads, fitments, the vehicle catalog and links',{skip:!process.env.DATABASE_URL},async()=>{
 const schema='make_fits_test_'+randomUUID().replaceAll('-','');
 const connection=new URL(process.env.DATABASE_URL!);connection.searchParams.set('options',`-c search_path=${schema}`);
 const admin=new Pool({connectionString:process.env.DATABASE_URL});
 const pool=new Pool({connectionString:connection.href});
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE supplier_items(id uuid PRIMARY KEY,code text,product_data jsonb,supplier text,presence text DEFAULT 'present');
   CREATE TABLE products(id uuid PRIMARY KEY,brand text,part_number text,name text,merged_into uuid,updated_at timestamptz DEFAULT now());
   CREATE TABLE product_sources(supplier_item_id uuid PRIMARY KEY,product_id uuid,method text DEFAULT 'auto');
   CREATE TABLE brands(id bigint PRIMARY KEY,key text,name text);CREATE TABLE supplier_brands(supplier text,label text,brand_id bigint,PRIMARY KEY(supplier,label));
   CREATE TABLE vehicle_brands(id integer PRIMARY KEY,name text);
   CREATE TABLE vehicle_models(id integer PRIMARY KEY,brand_id integer NOT NULL REFERENCES vehicle_brands(id),name text);
   CREATE TABLE vehicle_types(id integer PRIMARY KEY,model_id integer NOT NULL REFERENCES vehicle_models(id),name text);
   CREATE TABLE accounts(id uuid PRIMARY KEY);
   CREATE TABLE product_override_changes(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,product_id uuid,field text,old_value text,new_value text,changed_by uuid,reason text);`);
  const matching=await readFile('db/product-matching.sql','utf8');
  await pool.query(matching.slice(0,matching.indexOf('-- Reviewed brand decisions;')));
  for(const file of ['product-enrichment','enrichment-worker','product-fitments','product-override-fitments','enrichment-products','enrichment-shared-links','storefront-make-fits'])
   await pool.query(await readFile(`db/${file}.sql`,'utf8'));
  const brandIds=[1,2],modelIds=[10,11,20];
  const table=async(brand:number)=>(await pool.query('SELECT supplier_item_id::text AS id FROM storefront_make_fits WHERE brand_id=$1 ORDER BY 1',[brand])).rows.map(row=>row.id);
  const modelTable=async(model:number)=>(await pool.query('SELECT supplier_item_id::text AS id FROM storefront_model_fits WHERE model_id=$1 ORDER BY 1',[model])).rows.map(row=>row.id);
  const consistent=async()=>{
   await syncSharedLinks(pool);
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_enrichment_shared_queue')).rows[0].n,0);
   const lists:Record<number,string[]>={};
   for(const brand of brandIds){
    const expected=(await pool.query(live,[brand])).rows.map(row=>row.id).sort();
    assert.deepEqual(await table(brand),expected,`make ${brand}`);
    lists[brand]=expected;
   }
   for(const model of modelIds){
    const expected=(await pool.query(liveModel,[model])).rows.map(row=>row.id).sort();
    assert.deepEqual(await modelTable(model),expected,`model ${model}`);
    lists[model]=expected;
   }
   return lists;
  };
  await pool.query("INSERT INTO vehicle_brands VALUES(1,'VW'),(2,'BMW');INSERT INTO vehicle_models VALUES(10,1,'GOLF'),(11,1,'POLO'),(20,2,'3');INSERT INTO vehicle_types VALUES(100,10,'1.6'),(110,11,'1.4'),(200,20,'320d')");
  const donor=randomUUID(),target=randomUUID(),unlinked=randomUUID();
  await pool.query(`INSERT INTO supplier_items(id,code,product_data,supplier) VALUES
   ($1,'FEBI 181123','{"uk":"FEBI"}','basbug'),($2,'FEBI 181123','{"uk":"FEBI"}','basbug'),($3,'MAHLE OX1','{"uk":"MAHLE"}','basbug')`,[donor,target,unlinked]);
  await pool.query("INSERT INTO products(id,brand,part_number) VALUES($1,'FEBI','181123')",[donor]);
  await pool.query('INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1),($2,$1)',[donor,target]);
  await pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status)
   SELECT id,code,product_data->>'uk','complete' FROM supplier_items WHERE id IN ($1,$2)`,[donor,unlinked]);
  const payload=(vehicles:object[])=>JSON.stringify({vehicles,specifications:[],oemNumbers:{}});
  await pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
   VALUES($1,'FEBI 181123','FEBI','https://www.trodo.com/febi','test','FEBI BILSTEIN','181123',$3),
         ($2,'MAHLE OX1','MAHLE','https://www.trodo.com/mahle','test','MAHLE','OX1',$4)`,
   [donor,unlinked,payload([{model:'GOLF'},{model:'320d'}]),payload([{model:'320d'}])]);
  await pool.query(`INSERT INTO product_vehicle_fitments(supplier_item_id,source_index,source_vehicle,vehicle_type_id,match_status,matcher_version) VALUES
   ($1,0,'{"model":"GOLF"}',100,'matched','t'),($1,1,'{"model":"320d"}',200,'matched','t'),($2,0,'{"model":"320d"}',200,'matched','t')`,[donor,unlinked]);
  // A fresh schema queues a full build; both offers of the product share the donor's makes, the unlinked item has its own.
  let lists=await consistent();
  assert.deepEqual(lists[1],[donor,target].sort());
  assert.deepEqual(lists[2],[donor,target,unlinked].sort());
  assert.deepEqual([lists[10],lists[11],lists[20]],[[donor,target].sort(),[],[donor,target,unlinked].sort()]);
  // The payload's vehicle at index 1 changes: that fitment no longer agrees, BMW is gone for the product.
  await pool.query("UPDATE product_enrichments SET payload=$2 WHERE supplier_item_id=$1",[donor,payload([{model:'GOLF'},{model:'330d'}])]);
  lists=await consistent();
  assert.deepEqual(lists[2],[unlinked]);
  assert.deepEqual(lists[20],[unlinked]);
  // The GOLF fitment is rematched to another model of the same make: the make list stays, the model lists move.
  await pool.query('UPDATE product_vehicle_fitments SET vehicle_type_id=110 WHERE supplier_item_id=$1 AND source_index=0',[donor]);
  lists=await consistent();
  assert.deepEqual(lists[1],[donor,target].sort());
  assert.deepEqual([lists[10],lists[11]],[[],[donor,target].sort()]);
  // The fitment is rematched to the BMW type: the product moves from VW to BMW.
  await pool.query('UPDATE product_vehicle_fitments SET vehicle_type_id=200 WHERE supplier_item_id=$1 AND source_index=0',[donor]);
  lists=await consistent();
  assert.deepEqual(lists[1],[]);
  assert.deepEqual(lists[2],[donor,target,unlinked].sort());
  // The type moves to a VW model (catalog import): everything fitted to it follows.
  await pool.query('UPDATE vehicle_types SET model_id=10 WHERE id=200');
  lists=await consistent();
  assert.deepEqual(lists[1],[donor,target,unlinked].sort());
  assert.deepEqual(lists[2],[]);
  assert.deepEqual([lists[10],lists[20]],[[donor,target,unlinked].sort(),[]]);
  // The target leaves the product: it no longer shares the donor's data.
  await pool.query('DELETE FROM product_sources WHERE supplier_item_id=$1',[target]);
  lists=await consistent();
  assert.deepEqual(lists[1],[donor,unlinked].sort());
  // Removed fitments leave no make or model behind.
  await pool.query('DELETE FROM product_vehicle_fitments WHERE supplier_item_id=$1',[unlinked]);
  lists=await consistent();
  assert.deepEqual(lists[1],[donor]);
  // An admin removes the product's last VW fitment (#583): its make goes; an added BMW type lists the product and the
  // target that left it gets its own product with an added type, without any enrichment link.
  await pool.query("INSERT INTO products(id,brand,part_number) VALUES($1,'FEBI','181123X')",[target]);
  await pool.query('INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$1)',[target]);
  await pool.query("INSERT INTO vehicle_types VALUES(201,20,'318i')");
  await pool.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,200,'remove'),($1,201,'add'),($2,201,'add')`,[donor,target]);
  lists=await consistent();
  assert.deepEqual(lists[1],[]);
  assert.deepEqual(lists[2],[donor,target].sort());
  // The model tables take the same decisions: the removed type's model drops the product, the added type's model
  // lists both offers (the target without any link, no key violation).
  assert.deepEqual(lists[10],[]);
  assert.deepEqual(lists[20],[donor,target].sort());
  await pool.query("DELETE FROM product_override_fitments WHERE mode='add'");
  lists=await consistent();
  assert.deepEqual(lists[2],[]);
  assert.deepEqual(lists[20],[]);
  // An added type of another model lists the unlinked target there; the product's own model is untouched.
  await pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,110,'add')",[target]);
  lists=await consistent();
  assert.deepEqual(lists[11],[target]);
  assert.deepEqual(lists[1],[target]);
  await pool.query('DELETE FROM product_override_fitments');
  lists=await consistent();
  assert.deepEqual(lists[1],[donor]);
  assert.deepEqual([lists[10],lists[11]],[[donor],[]]);
  // The donor's enrichment is deleted: its links and fitments go, and the make rows (keyed to supplier_items since
  // #583, no longer cascaded from the links) leave with the queued refresh.
  await pool.query('DELETE FROM product_enrichments WHERE supplier_item_id=$1',[donor]);
  lists=await consistent();
  assert.deepEqual(lists[1],[]);
  assert.deepEqual(lists[2],[]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM storefront_make_fits')).rows[0].n,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM storefront_model_fits')).rows[0].n,0);
 } finally {await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
