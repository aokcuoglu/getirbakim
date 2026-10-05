import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {Pool} from 'pg';
const db=new Pool({connectionString:process.env.DATABASE_URL});
const base=process.env.VERIFY_URL || 'http://localhost:3000';
const token=randomBytes(32).toString('hex');const adminToken=randomBytes(32).toString('hex');
let accountId='',adminId='',productId='',orderId='',guestOrderId='',guestHash='';
const cookie=`gb_session=${token}`;const adminCookie=`gb_session=${adminToken}`;
async function get(path:string,cookieValue=cookie){const res=await fetch(base+path,{headers:{cookie:cookieValue},redirect:'manual'});return {res,html:await res.text()};}
function fields(html:string,field:string){
 const form=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(m=>m[1]).find(f=>f.includes(`name="${field}"`) && f.includes('$ACTION_ID_'));
 assert.ok(form,`Missing action form ${field}`);const data=new FormData();
 for(const input of form.matchAll(/<input\b[^>]*>/g)) {const name=input[0].match(/name="([^"]+)"/)?.[1];if(name)data.set(name,input[0].match(/value="([^"]*)"/)?.[1] ?? '');}
 return data;
}
async function post(path:string,body:FormData,cookieValue=cookie){return fetch(base+path,{method:'POST',headers:{cookie:cookieValue,origin:base},body,redirect:'manual'});}
try {
 accountId=(await db.query("INSERT INTO accounts(name,email,password_hash,role,approved,discount_percent) VALUES('HTTP verify',$1,'unused','service',true,10) RETURNING id",[`${token}@example.invalid`])).rows[0].id;
 adminId=(await db.query("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('HTTP verify admin',$1,'unused','admin',true) RETURNING id",[`${adminToken}@example.invalid`])).rows[0].id;
 for(const [t,id] of [[token,accountId],[adminToken,adminId]]) await db.query("INSERT INTO sessions VALUES($1,$2,now()+interval '5 minutes')",[createHash('sha256').update(t).digest('hex'),id]);
 productId=(await db.query("INSERT INTO products(supplier,code,name,brand,price_kurus,stock) VALUES('demo',$1,'HTTP verify product','VERIFY',10000,2) RETURNING id",[`HTTP-${token}`])).rows[0].id;
 const detail=await get(`/urun/${productId}`);assert.equal(detail.res.status,200);assert.ok(detail.html.includes('90,00'));
 const add=fields(detail.html,'productId');add.set('quantity','1');assert.equal((await post('/sepet',add)).status,303);
 const cart=await get('/sepet');assert.equal(cart.res.status,200);const checkout=fields(cart.html,'requestKey');
 for(const [k,v] of Object.entries({name:'Verification Buyer',email:'verify@example.invalid',phone:'5551234567',address:'Synthetic address only, Istanbul',note:'HTTP test',consent:'on'}))checkout.set(k,v);
 const placed=await post('/sepet',checkout);assert.equal(placed.status,303);orderId=placed.headers.get('location')?.split('/').pop() ?? '';assert.match(orderId,/^[a-f0-9-]{36}$/);
 assert.equal((await db.query('SELECT total_kurus,discount_percent FROM commerce_orders WHERE id=$1',[orderId])).rows[0].total_kurus,'9000');
 assert.ok((await get(`/siparis/${orderId}`)).html.includes('Teyit bekliyor'));
 assert.equal((await get(`/siparis/${orderId}`,'' )).res.status,404);
 assert.equal((await post('/sepet',checkout)).headers.get('location'),`/siparis/${orderId}`);
 for(const route of ['/yonetim/fiyatlandirma','/yonetim/servisler','/yonetim/siparisler']) {assert.equal((await get(route,adminCookie)).res.status,200);assert.equal((await get(route)).res.status,307);}
 const pricing=await get('/yonetim/fiyatlandirma',adminCookie);const badPricing=fields(pricing.html,'markup');badPricing.set('markup','-1');badPricing.set('vat','20');badPricing.set('age','36');
 const rejected=await post('/yonetim/fiyatlandirma',badPricing,adminCookie);assert.ok(rejected.headers.get('location')?.includes('error=1'));
 const services=await get('/yonetim/servisler',adminCookie);const service=fields(services.html,'id');service.set('id',accountId);service.set('discount','15');service.set('approved','true');assert.equal((await post('/yonetim/servisler',service)).status,303);
 assert.equal((await db.query('SELECT discount_percent FROM accounts WHERE id=$1',[accountId])).rows[0].discount_percent,10);
 assert.equal((await post('/yonetim/servisler',service,adminCookie)).status,303);
 assert.equal((await db.query('SELECT discount_percent FROM accounts WHERE id=$1',[accountId])).rows[0].discount_percent,15);
 assert.equal((await db.query('SELECT total_kurus FROM commerce_orders WHERE id=$1',[orderId])).rows[0].total_kurus,'9000');
 const orders=await get('/yonetim/siparisler',adminCookie);const status=fields(orders.html,'status');status.set('id',orderId);status.set('status','cancelled');assert.equal((await post('/yonetim/siparisler',status,adminCookie)).status,303);
 assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,2);
 await post('/yonetim/siparisler',status,adminCookie);assert.equal((await db.query('SELECT stock FROM products WHERE id=$1',[productId])).rows[0].stock,2);
 const guestDetail=await get(`/urun/${productId}`,'');const guestAdd=fields(guestDetail.html,'productId');guestAdd.set('quantity','1');
 const guestAdded=await post('/sepet',guestAdd,'');const guestCookie=guestAdded.headers.getSetCookie().find(c=>c.startsWith('gb_cart='))?.split(';')[0] ?? '';assert.ok(guestCookie);
 guestHash=createHash('sha256').update(guestCookie.slice('gb_cart='.length)).digest('hex');
 const guestCart=await get('/sepet',guestCookie);const guestCheckout=fields(guestCart.html,'requestKey');
 for(const [k,v] of Object.entries({name:'Guest Verification',email:'guest@example.invalid',phone:'5551234567',address:'Synthetic address only, Istanbul',note:'Guest test',consent:'on'}))guestCheckout.set(k,v);
 const guestPlaced=await post('/sepet',guestCheckout,guestCookie);assert.equal(guestPlaced.status,303);guestOrderId=guestPlaced.headers.get('location')?.split('/').pop() ?? '';assert.match(guestOrderId,/^[a-f0-9-]{36}$/);
 assert.equal((await get(`/siparis/${guestOrderId}`,guestCookie)).res.status,200);
 assert.equal((await get(`/siparis/${guestOrderId}`)).res.status,404);
 const mixedCookie=`${cookie}; ${guestCookie}`;assert.equal((await get(`/siparis/${guestOrderId}`,mixedCookie)).res.status,200);
 assert.ok((await get('/siparisler',mixedCookie)).html.includes(guestOrderId));
 console.log('PASS: B2B price; actual server-action add/checkout; order ownership; checkout replay; admin pages; service discount editing; immutable past prices; order cancellation restores stock once; guest checkout and order access after login.');
} finally {
 for(const id of [orderId,guestOrderId])if(id){await db.query('DELETE FROM commerce_order_items WHERE order_id=$1',[id]);await db.query('DELETE FROM commerce_orders WHERE id=$1',[id]);}
 if(guestHash)await db.query('DELETE FROM guest_carts WHERE token_hash=$1',[guestHash]);
 for(const id of [accountId,adminId])if(id)await db.query('DELETE FROM accounts WHERE id=$1',[id]);
 if(productId)await db.query('DELETE FROM products WHERE id=$1',[productId]);await db.end();
}
