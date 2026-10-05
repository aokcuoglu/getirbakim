import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/lib/db';
import { getProduct,browseProducts } from '../src/modules/store/catalog';
import { setCartQuantity,cartFor,type CartOwner } from '../src/modules/store/cart';
import { submitOrder,cartQuote } from '../src/modules/store/orders';
const owner:CartOwner={kind:'guest',id:randomUUID().replaceAll('-','')};
let productId='', supplierFixture='';const orderIds:string[]=[];
const input={requestKey:randomUUID(),quote:'',name:'Commerce verification',email:'commerce@example.invalid',phone:'5551234567',address:'Test address only, Istanbul',note:'Synthetic verification; delete after run'};
try {
 const supplier=(await db.query<{id:string}>('SELECT id FROM commerce_catalog WHERE code=$1',["AE FOL214"])).rows[0];
 assert.ok(supplier);
 const p=await getProduct(supplier.id);assert.ok(p && p.price_kurus);
 const snap=p.pricing_snapshot;
 assert.equal(p.price_kurus,Math.round(Number(snap.nf)*Number(snap.exchange_rate)*(1+Number(snap.markup_percent)/100)*(1+Number(snap.vat_percent)/100)*100));
 assert.equal(p.stock,null);assert.equal(p.stock_label,'Diğer depoda mevcut');assert.equal(p.available,true);
 supplierFixture=(await db.query<{id:string}>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
 SELECT supplier,company,list_group,warehouse,$2,product_data,price_data,stock_data,1,1,1,now(),now()-interval '8 days',now() FROM supplier_items WHERE id=$1 RETURNING id`,[supplier.id,'STALE-'+randomUUID()])).rows[0].id;
 const stale=await getProduct(supplierFixture);assert.equal(stale?.price_kurus,null);assert.equal(stale?.available,false);
 await db.query("UPDATE supplier_items SET last_seen_at=now(),product_data=jsonb_set(product_data,'{dc}','\"UNKNOWN\"'::jsonb) WHERE id=$1",[supplierFixture]);
 assert.equal((await getProduct(supplierFixture))?.price_kurus,null);
 await db.query('UPDATE supplier_items SET price_data=NULL WHERE id=$1',[supplierFixture]);
 assert.equal((await getProduct(supplierFixture))?.price_kurus,null);
 const catalog=await browseProducts({q:'AE FOL214',searchBy:'code'});assert.ok(catalog.items.some(i=>i.id===p.id));
 await db.query('INSERT INTO guest_carts(token_hash) VALUES($1)',[owner.id]);
 productId=(await db.query<{id:string}>("INSERT INTO products(supplier,code,name,brand,price_kurus,stock) VALUES('demo',$1,'Commerce verification','VERIFY',10000,3) RETURNING id",['VERIFY-'+randomUUID()])).rows[0].id;
 assert.equal(await setCartQuantity(owner,productId,1,true),true);
 assert.equal(await setCartQuantity(owner,productId,1,true),true);
 assert.equal(await setCartQuantity(owner,productId,2,true),false);
 assert.equal((await cartFor(owner))[0].quantity,2);
 assert.equal(await setCartQuantity(owner,p.id,2,true),true);
 let items=await cartFor(owner);assert.equal(items.length,2);input.quote=cartQuote(items,0);
 assert.equal((await submitOrder(owner,{...input,quote:'a'.repeat(64)})).error,'price');
 assert.equal((await cartFor(owner)).length,2);
 const results=await Promise.all([submitOrder(owner,input),submitOrder(owner,input)]);
 assert.ok(results[0].id);assert.equal(results[0].id,results[1].id);orderIds.push(results[0].id!);
 assert.equal((await cartFor(owner)).length,0);
 assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,1);
 assert.equal((await db.query('SELECT count(*) FROM commerce_order_items WHERE order_id=$1',[results[0].id])).rows[0].count,'2');
 const snapshot=(await db.query('SELECT pricing_snapshot FROM commerce_order_items WHERE order_id=$1 AND product_id=$2',[results[0].id,p.id])).rows[0].pricing_snapshot;
 assert.equal(snapshot.nf,snap.nf);assert.equal(snapshot.discount_percent,0);
 assert.equal(await setCartQuantity(owner,productId,2),false);
 assert.equal(await setCartQuantity(owner,p.id,0),true);
 // A sold-out store product cannot produce an order.
 assert.equal(await setCartQuantity(owner,productId,1),true);
 items=await cartFor(owner);await db.query('UPDATE products SET stock=0 WHERE id=$1',[productId]);
 assert.equal((await submitOrder(owner,{...input,requestKey:randomUUID(),quote:cartQuote(items,0)})).error,'stock');
 // Anonymous public HTML must contain TRY prices and supplier purchasing controls.
 const base=process.env.VERIFY_URL || 'http://localhost:3000';
 const html=await (await fetch(`${base}/katalog?q=AE%20FOL214&searchBy=code`)).text();
 assert.ok(html.includes('Diğer depoda mevcut'));assert.ok(html.includes('Sepete ekle'));assert.ok(!html.includes('Satış fiyatı hazırlanıyor'));
 const detail=await fetch(`${base}/urun/${p.id}`);assert.equal(detail.status,200);assert.ok((await detail.text()).includes('KDV dahil'));
 assert.equal((await fetch(`${base}/siparis/${results[0].id}`)).status,404);
 for(const path of ['/yonetim/fiyatlandirma','/yonetim/servisler','/yonetim/siparisler']) assert.equal((await fetch(base+path,{redirect:'manual'})).status,307);
 console.log('PASS: NF + FX + markup + VAT; supplier availability; catalog/detail purchase controls; anonymous admin/order isolation; additive cart quantities; stock limits; price-change rejection; simultaneous checkout idempotency; store reservation; supplier order snapshots; unavailable-product rejection.');
} finally {
 for(const id of orderIds) {await db.query('DELETE FROM commerce_order_items WHERE order_id=$1',[id]);await db.query('DELETE FROM commerce_orders WHERE id=$1',[id]);}
 await db.query('DELETE FROM guest_carts WHERE token_hash=$1',[owner.id]);
 if(productId)await db.query('DELETE FROM products WHERE id=$1',[productId]);
 if(supplierFixture)await db.query('DELETE FROM supplier_items WHERE id=$1',[supplierFixture]);
 await db.end();
}
