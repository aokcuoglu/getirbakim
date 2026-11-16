import 'server-only';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import type { PoolClient } from 'pg';
import { cartFor,lockCartOwner,type CartOwner,type CartItem } from './cart';
import { refreshCheckoutSources,checkoutItems } from './supplier-checkout';
import { supplierCheckoutMode } from './supplier-checkout-policy';
import { servicePrice } from './catalog';
import { paymentsEnabled,PAYMENT_WINDOW_MINUTES } from '@/modules/payments/checkout';
import { parseGarageVehicle,type GarageVehicle } from './garage';
import { fitmentLevelResolver,productFitmentLevels } from './fitment-level.server';
import type { FitmentLevel } from './fitment-level';
import { buildOrderAgreement,legalTextVersion,type AgreementLine } from './order-agreement';
import { checkoutConsentText } from './checkout-schema';
import type { ClientEvidence } from '@/lib/client-address';
import { CHECKOUT_LOCK_TIMEOUT } from '@/modules/suppliers/checkout-fallback';

export type CommerceOrder = {
 id:string; number:string; owner_kind:'account'|'guest'; owner_id:string;
 customer_name:string; email:string; phone:string; address:string; note:string;
 total_kurus:string; subtotal_kurus:string; shipping_kurus:string; discount_percent:number;
 status:'awaiting_payment'|'pending'|'confirmed'|'shipped'|'delivered'|'cancelled'; created_at:Date;
 payment_status:'none'|'awaiting'|'paid'|'expired'|'cancelled'|'refund_required'|'refunded';
 payment_due_at:Date|null; paid_at:Date|null; payment_note:string; refund_reference:string|null; refunded_at:Date|null;
 // Shipment (#605); NULL on orders shipped before it was recorded. carrier is a code from ./shipment.
 carrier:string|null; carrier_name:string|null; tracking_no:string|null; tracking_url:string|null; shipped_at:Date|null; delivered_at:Date|null;
 // Who cancelled and when (#607); NULL on orders cancelled before it was recorded and on open orders.
 cancelled_by:'customer'|'admin'|'expiry'|null; cancelled_at:Date|null;
};
export type OrderItem = {product_id:string; name:string; code:string; quantity:number; unit_price_kurus:string; pricing_snapshot:Record<string,unknown>; vehicle:GarageVehicle|null; fitment_level:FitmentLevel|null};

export type ShippingRule = {fee:number;threshold:number};
export async function shippingRule(connection:Pick<PoolClient,'query'>=db):Promise<ShippingRule> {
 const row=(await connection.query<{shipping_fee_kurus:number;free_shipping_threshold_kurus:number}>('SELECT shipping_fee_kurus,free_shipping_threshold_kurus FROM commerce_settings WHERE id=true')).rows[0];
 return {fee:row?.shipping_fee_kurus ?? 0,threshold:row?.free_shipping_threshold_kurus ?? 0};
}
export function cartQuote(items: CartItem[],discount:number,shipping:ShippingRule) {
 return createHash('sha256').update(JSON.stringify([items.map(p=>[p.id,p.quantity,p.price_kurus,discount,p.pricing_snapshot?.checkout_mode]),shipping.fee,shipping.threshold])).digest('hex');
}
export function cartTotal(items:CartItem[],discount:number) {
 return items.reduce((total,p)=>total+servicePrice(p.price_kurus ?? 0,discount)*p.quantity,0);
}
/** Shipping is charged up front because payment is collected before operations confirm the order. */
export function orderTotals(items:CartItem[],discount:number,shipping:ShippingRule) {
 const subtotal=cartTotal(items,discount);
 const free=shipping.fee===0 || (shipping.threshold>0 && subtotal>=shipping.threshold);
 const fee=items.length && !free ? shipping.fee : 0;
 return {subtotal,shipping:fee,total:subtotal+fee,freeShippingRemaining:!free && shipping.threshold>0 ? shipping.threshold-subtotal : 0};
}
export type CheckoutInput = {requestKey:string;quote:string;name:string;email:string;phone:string;address:string;note:string};
/**
 * `garage` is used for cart lines added before a vehicle was recorded on them. `evidence` is who accepted the
 * pre-contract documents; the consent and the order-specific copy of those documents are stored with the order.
 */
export async function submitOrder(owner:CartOwner,input:CheckoutInput,garage:GarageVehicle|null=null,evidence:ClientEvidence={ip:null,forwardedFor:null,userAgent:null}):Promise<{id:string;error?:undefined}|{error:string;id?:undefined}> {
 // Completed retries must not require another supplier call.
 const completed=(await db.query<{id:string}>('SELECT id FROM commerce_orders WHERE owner_kind=$1 AND owner_id=$2 AND request_key=$3',[owner.kind,owner.id,input.requestKey])).rows[0];
 if(completed) return {id:completed.id};
 if(!paymentsEnabled()) return {error:'payment'};
 let refreshed:Awaited<ReturnType<typeof refreshCheckoutSources>>;
 // Supplier failures do not throw (#763); only the refresh's own database errors end up here.
 try { refreshed=await refreshCheckoutSources(owner); }
 catch { return {error:'supplier'}; }
 // Fitment levels are read before the transaction (#708): its locks are not held while the catalog is queried.
 const cartLines=(await db.query<{product_id:string;vehicle:unknown}>('SELECT product_id::text,vehicle FROM commerce_cart_items WHERE owner_kind=$1 AND owner_id=$2',[owner.kind,owner.id])).rows;
 const preloaded=await fitmentLevelResolver(cartLines.map(line=>line.product_id),cartLines.map(line=>parseGarageVehicle(line.vehicle) ?? garage));
 const client=await db.connect();
 try {
  await client.query('BEGIN');
  await lockCartOwner(client,owner);
  const existing=(await client.query<{id:string}>('SELECT id FROM commerce_orders WHERE owner_kind=$1 AND owner_id=$2 AND request_key=$3',[owner.kind,owner.id,input.requestKey])).rows[0];
  if(existing) { await client.query('COMMIT'); return {id:existing.id}; }
  // A cart changed during the API call must be quoted and checked again.
  const currentItems=(await checkoutItems(owner,client)).map(item=>item.id);
  if(JSON.stringify(currentItems)!==JSON.stringify(refreshed.items)) { await client.query('ROLLBACK'); return {error:'stock'}; }
  // (#770) The supplier no longer knows these codes (604 / empty getStock); refused even when the zeroed stock could not be saved.
  if(refreshed.gone.length) { await client.query('ROLLBACK'); return {error:'stock'}; }
  await client.query('SELECT id FROM commerce_settings FOR SHARE');
  if(await supplierCheckoutMode(client)!==refreshed.mode) { await client.query('ROLLBACK'); return {error:'price'}; }
  // Lock saleable sources while prices are checked and store stock is reserved.
  await client.query(`SELECT p.id FROM store_products p JOIN commerce_cart_items c ON c.product_id=p.id WHERE c.owner_kind=$1 AND c.owner_id=$2 ORDER BY p.id FOR UPDATE OF p`,[owner.kind,owner.id]);
  // A supplier list import (#790) updates every row in its scope and holds them until it commits: the order waits at
  // most CHECKOUT_LOCK_TIMEOUT, then goes on without the share lock and reads the rows as committed before the import.
  // The quote check below still refuses a changed price; lock_timeout is reset so later writes wait normally.
  await client.query('SAVEPOINT supplier_rows');
  await client.query(CHECKOUT_LOCK_TIMEOUT);
  try {
   await client.query(`SELECT p.id FROM supplier_items p JOIN commerce_cart_items c ON c.product_id=p.id WHERE c.owner_kind=$1 AND c.owner_id=$2 ORDER BY p.id FOR SHARE OF p`,[owner.kind,owner.id]);
   await client.query('RELEASE SAVEPOINT supplier_rows');
  } catch(error) {
   if((error as {code?:unknown}).code!=='55P03') throw error;
   await client.query('ROLLBACK TO SAVEPOINT supplier_rows');
   console.warn(`submitOrder: supplier rows locked by an import, continuing with committed data (${owner.kind}, request ${input.requestKey})`);
  }
  await client.query('SET LOCAL lock_timeout = 0');
  const account=owner.kind==='account' ? (await client.query<{role:string;discount_percent:number}>('SELECT role,discount_percent FROM accounts WHERE id=$1',[owner.id])).rows[0] : null;
  const discount=account?.role==='service' ? account.discount_percent : 0;
  const items=await cartFor(owner,client);
  if(!items.length || items.some(p=>!p.available || !p.price_kurus || p.quantity>p.max_quantity || servicePrice(p.price_kurus,discount)<1)) {
   await client.query('ROLLBACK'); return {error:'stock'};
  }
  const shipping=await shippingRule(client);
  if(cartQuote(items,discount,shipping)!==input.quote) { await client.query('ROLLBACK'); return {error:'price'}; }
  const totals=orderTotals(items,discount,shipping);
  const vehicles=items.map(p=>parseGarageVehicle(p.vehicle) ?? garage);
  let levels=items.map((p,i)=>preloaded.level(p,vehicles[i]));
  // The cart changed after the preload: resolve again, once, for all lines.
  if(levels.includes(null)) levels=await productFitmentLevels(items.map((p,i)=>({product:p,vehicle:vehicles[i]})));
  const order=(await client.query<{id:string;number:string;created_at:Date}>(`INSERT INTO commerce_orders(owner_kind,owner_id,request_key,customer_name,email,phone,address,note,total_kurus,discount_percent,
   subtotal_kurus,shipping_kurus,status,payment_status,payment_due_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'awaiting_payment','awaiting',now()+make_interval(mins=>$13)) RETURNING id,number,created_at`,
   [owner.kind,owner.id,input.requestKey,input.name,input.email,input.phone,input.address,input.note,totals.total,discount,totals.subtotal,totals.shipping,PAYMENT_WINDOW_MINUTES])).rows[0];
  const lines:AgreementLine[]=[];
  for(const [i,p] of items.entries()) {
   const unitPrice=servicePrice(p.price_kurus!,discount);
   // The contract names the part as the store showed it (#602); the order line keeps the supplier's code for operations.
   lines.push({name:p.name,brand:p.display_brand,code:p.display_code,quantity:p.quantity,unitPriceKurus:unitPrice});
   const vehicle=vehicles[i];
   // Only in-house stock is reserved; the line records what was taken so cancel/expiry return exactly that.
   const reserved=p.source==='store' ? p.quantity : 0;
   if(reserved && !(await client.query('UPDATE store_products SET stock=stock-$2,updated_at=now() WHERE id=$1 AND stock>=$2',[p.id,reserved])).rowCount) {
    await client.query('ROLLBACK'); return {error:'stock'};
   }
   // A line the supplier could not confirm live was sold on its saved data (#763): operations confirm it with the supplier.
   const reason=refreshed.unverified[p.id];
   const snapshot={...p.pricing_snapshot,discount_percent:discount,...(reason ? {checkout_mode:'snapshot',live_check:'failed',live_check_reason:reason} : {})};
   await client.query(`INSERT INTO commerce_order_items(order_id,product_id,code,name,supplier,quantity,unit_price_kurus,pricing_snapshot,vehicle,fitment_level,reserved_quantity)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[order.id,p.id,p.code,p.name,p.supplier,p.quantity,unitPrice,JSON.stringify(snapshot),vehicle ? JSON.stringify(vehicle) : null,levels[i],reserved]);
  }
  const document=buildOrderAgreement({number:order.number,createdAt:order.created_at,name:input.name,email:input.email,phone:input.phone,address:input.address,note:input.note,
   discountPercent:discount,subtotalKurus:totals.subtotal,shippingKurus:totals.shipping,totalKurus:totals.total},lines);
  await client.query(`INSERT INTO commerce_order_agreements(order_id,ip,forwarded_for,user_agent,consent_text,legal_version,document) VALUES($1,$2,$3,$4,$5,$6,$7)`,
   [order.id,evidence.ip,evidence.forwardedFor,evidence.userAgent,checkoutConsentText,legalTextVersion(),JSON.stringify(document)]);
  // The cart stays until TAMI confirms payment, so a declined card can be retried.
  await client.query('COMMIT'); return {id:order.id};
 } catch(error) { await client.query('ROLLBACK'); throw error; }
 finally {client.release();}
}
export const orderStatus:Record<string,string>={awaiting_payment:'Ödeme bekleniyor',pending:'Teyit bekliyor',confirmed:'Onaylandı',shipped:'Kargoya verildi',delivered:'Teslim edildi',cancelled:'İptal edildi'};
export const paymentStatus:Record<string,string>={none:'Ödeme alınmadı',awaiting:'Ödeme bekleniyor',paid:'Ödendi',expired:'Ödeme süresi doldu',cancelled:'Ödeme alınmadı',refund_required:'İade bekliyor',refunded:'İade edildi'};
