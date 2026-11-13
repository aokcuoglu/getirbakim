import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

// The make lists the storefront reads (#455) must equal the live per-make computation after every write path.
const live=`WITH types AS MATERIALIZED (SELECT v.id FROM vehicle_types v JOIN vehicle_models m ON m.id=v.model_id WHERE m.brand_id=$1),
 fits AS MATERIALIZED (SELECT f.supplier_item_id,f.source_index,f.source_vehicle FROM types JOIN product_vehicle_fitments f ON f.vehicle_type_id=types.id),
 trusted AS MATERIALIZED (SELECT e.supplier_item_id,e.donor_item_id,e.payload->'vehicles' AS vehicles FROM product_enrichment_shared e
  JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
  AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
  WHERE e.donor_item_id IN (SELECT supplier_item_id FROM fits))
 SELECT DISTINCT t.supplier_item_id::text AS id FROM fits f JOIN trusted t ON t.donor_item_id=f.supplier_item_id AND f.source_vehicle=t.vehicles->f.source_index`;

test('storefront make lists follow payloads, fitments, the vehicle catalog and links',{skip:!process.env.DATABASE_URL},async()=>{
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
   CREATE TABLE vehicle_types(id integer PRIMARY KEY,model_id integer NOT NULL REFERENCES vehicle_models(id),name text);`);
  const matching=await readFile('db/product-matching.sql','utf8');
  await pool.query(matching.slice(0,matching.indexOf('-- Reviewed brand decisions;')));
  for(const file of ['product-enrichment','enrichment-worker','product-fitments','enrichment-products','enrichment-shared-links','storefront-make-fits'])
   await pool.query(await readFile(`db/${file}.sql`,'utf8'));
  const brandIds=[1,2];
  const table=async(brand:number)=>(await pool.query('SELECT supplier_item_id::text AS id FROM storefront_make_fits WHERE brand_id=$1 ORDER BY 1',[brand])).rows.map(row=>row.id);
  const consistent=async()=>{
   await pool.query('SELECT product_enrichment_shared_sync()');
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM product_enrichment_shared_queue')).rows[0].n,0);
   const lists:Record<number,string[]>={};
   for(const brand of brandIds){
    const expected=(await pool.query(live,[brand])).rows.map(row=>row.id).sort();
    assert.deepEqual(await table(brand),expected,`make ${brand}`);
    lists[brand]=expected;
   }
   return lists;
  };
  await pool.query("INSERT INTO vehicle_brands VALUES(1,'VW'),(2,'BMW');INSERT INTO vehicle_models VALUES(10,1,'GOLF'),(20,2,'3');INSERT INTO vehicle_types VALUES(100,10,'1.6'),(200,20,'320d')");
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
  // The payload's vehicle at index 1 changes: that fitment no longer agrees, BMW is gone for the product.
  await pool.query("UPDATE product_enrichments SET payload=$2 WHERE supplier_item_id=$1",[donor,payload([{model:'GOLF'},{model:'330d'}])]);
  lists=await consistent();
  assert.deepEqual(lists[2],[unlinked]);
  // The GOLF fitment is rematched to the BMW type: the product moves from VW to BMW.
  await pool.query('UPDATE product_vehicle_fitments SET vehicle_type_id=200 WHERE supplier_item_id=$1 AND source_index=0',[donor]);
  lists=await consistent();
  assert.deepEqual(lists[1],[]);
  assert.deepEqual(lists[2],[donor,target,unlinked].sort());
  // The type moves to a VW model (catalog import): everything fitted to it follows.
  await pool.query('UPDATE vehicle_types SET model_id=10 WHERE id=200');
  lists=await consistent();
  assert.deepEqual(lists[1],[donor,target,unlinked].sort());
  assert.deepEqual(lists[2],[]);
  // The target leaves the product: it no longer shares the donor's data.
  await pool.query('DELETE FROM product_sources WHERE supplier_item_id=$1',[target]);
  lists=await consistent();
  assert.deepEqual(lists[1],[donor,unlinked].sort());
  // Removed fitments leave no make behind.
  await pool.query('DELETE FROM product_vehicle_fitments WHERE supplier_item_id=$1',[unlinked]);
  lists=await consistent();
  assert.deepEqual(lists[1],[donor]);
 } finally {await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
