import 'server-only';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { cartFor,lockCartOwner,type CartOwner,type CartItem } from './cart';
import { refreshCheckoutSources,checkoutScopes,type CheckoutScope } from './supplier-checkout';
import { servicePrice } from './catalog';

export type CommerceOrder = {
 id:string; number:string; owner_kind:'account'|'guest'; owner_id:string;
 customer_name:string; email:string; phone:string; address:string; note:string;
 total_kurus:string; discount_percent:number; status:'pending'|'confirmed'|'shipped'|'cancelled'; created_at:Date;
};
export type OrderItem = {product_id:string; name:string; code:string; quantity:number; unit_price_kurus:string};

export function cartQuote(items: CartItem[],discount:number) {
 return createHash('sha256').update(JSON.stringify(items.map(p=>[p.id,p.quantity,p.price_kurus,discount]))).digest('hex');
}
export function cartTotal(items:CartItem[],discount:number) {
 return items.reduce((total,p)=>total+servicePrice(p.price_kurus ?? 0,discount)*p.quantity,0);
}
export type CheckoutInput = {requestKey:string;quote:string;name:string;email:string;phone:string;address:string;note:string};
export async function submitOrder(owner:CartOwner,input:CheckoutInput) {
 // Completed retries must not require another supplier call.
 const completed=(await db.query<{id:string}>('SELECT id FROM commerce_orders WHERE owner_kind=$1 AND owner_id=$2 AND request_key=$3',[owner.kind,owner.id,input.requestKey])).rows[0];
 if(completed) return {id:completed.id};
 let refreshed:CheckoutScope[];
 try { refreshed=await refreshCheckoutSources(owner); }
 catch { return {error:'supplier'}; }
 const client=await db.connect();
 try {
  await client.query('BEGIN');
  await lockCartOwner(client,owner);
  const existing=(await client.query<{id:string}>('SELECT id FROM commerce_orders WHERE owner_kind=$1 AND owner_id=$2 AND request_key=$3',[owner.kind,owner.id,input.requestKey])).rows[0];
  if(existing) { await client.query('COMMIT'); return {id:existing.id}; }
  // A cart changed during the API call must be quoted and checked again.
  const currentScopes=await checkoutScopes(owner,client);
  if(JSON.stringify(currentScopes)!==JSON.stringify(refreshed)) { await client.query('ROLLBACK'); return {error:'stock'}; }
  await client.query('SELECT id FROM commerce_settings FOR SHARE');
  // Lock saleable sources while prices are checked and store stock is reserved.
  await client.query(`SELECT p.id FROM products p JOIN commerce_cart_items c ON c.product_id=p.id WHERE c.owner_kind=$1 AND c.owner_id=$2 ORDER BY p.id FOR UPDATE OF p`,[owner.kind,owner.id]);
  await client.query(`SELECT p.id FROM supplier_items p JOIN commerce_cart_items c ON c.product_id=p.id WHERE c.owner_kind=$1 AND c.owner_id=$2 ORDER BY p.id FOR SHARE OF p`,[owner.kind,owner.id]);
  const account=owner.kind==='account' ? (await client.query<{role:string;discount_percent:number}>('SELECT role,discount_percent FROM accounts WHERE id=$1',[owner.id])).rows[0] : null;
  const discount=account?.role==='service' ? account.discount_percent : 0;
  const items=await cartFor(owner,client);
  if(!items.length || items.some(p=>!p.available || !p.price_kurus || p.quantity>p.max_quantity || servicePrice(p.price_kurus,discount)<1)) {
   await client.query('ROLLBACK'); return {error:'stock'};
  }
  if(cartQuote(items,discount)!==input.quote) { await client.query('ROLLBACK'); return {error:'price'}; }
  const order=(await client.query<{id:string}>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,note,total_kurus,discount_percent)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[owner.kind,owner.id,input.requestKey,input.name,input.email,input.phone,input.address,input.note,cartTotal(items,discount),discount])).rows[0];
  for(const p of items) {
   await client.query('INSERT INTO commerce_order_items VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[order.id,p.id,p.code,p.name,p.supplier,p.quantity,servicePrice(p.price_kurus!,discount),JSON.stringify({...p.pricing_snapshot,discount_percent:discount})]);
   if(p.source==='store') await client.query('UPDATE products SET stock=stock-$2,updated_at=now() WHERE id=$1',[p.id,p.quantity]);
  }
  await client.query('DELETE FROM commerce_cart_items WHERE owner_kind=$1 AND owner_id=$2',[owner.kind,owner.id]);
  await client.query('COMMIT'); return {id:order.id};
 } catch(error) { await client.query('ROLLBACK'); throw error; }
 finally {client.release();}
}
export const orderStatus:Record<string,string>={pending:'Teyit bekliyor',confirmed:'Onaylandı',shipped:'Sevk edildi',cancelled:'İptal edildi'};
