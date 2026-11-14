'use server';
import { requireAdmin } from '@/modules/auth/session';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { returnReasons } from '@/modules/store/returns';
import { transitionOrder,recordOrderRefund } from './orders';
import { orderListBack,orderListReturn } from './order-list-return';
export async function savePricing(form:FormData) {
 const admin=await requireAdmin();
 const input=z.object({markup:z.coerce.number().min(0).max(1000).multipleOf(0.01),vat:z.coerce.number().min(0).max(100).multipleOf(0.01),age:z.coerce.number().int().min(1).max(168)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/fiyatlandirma?error=1');
 await db.query('UPDATE commerce_settings SET markup_percent=$1,vat_percent=$2,max_age_hours=$3,updated_at=now(),updated_by=$4 WHERE id=true',[input.data.markup,input.data.vat,input.data.age,admin.id]);
 revalidatePath('/','layout'); redirect('/yonetim/fiyatlandirma?saved=1');
}
/** Checkout data source shared by every supplier (commerce_settings.basbug_checkout_mode; the column name is historical). */
export async function saveCheckoutMode(form:FormData) {
 const admin=await requireAdmin();
 const mode=z.enum(['live','snapshot']).safeParse(form.get('checkoutMode'));
 if(!mode.success) redirect('/yonetim/fiyatlandirma?error=mode');
 await db.query('UPDATE commerce_settings SET basbug_checkout_mode=$1,updated_at=now(),updated_by=$2 WHERE id=true',[mode.data,admin.id]);
 revalidatePath('/','layout'); redirect('/yonetim/fiyatlandirma?modeSaved=1');
}
export async function saveShipping(form:FormData) {
 const admin=await requireAdmin();
 const input=z.object({fee:z.coerce.number().min(0).max(100000).multipleOf(0.01),threshold:z.coerce.number().min(0).max(10000000).multipleOf(0.01)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/fiyatlandirma?error=1');
 await db.query('UPDATE commerce_settings SET shipping_fee_kurus=$1,free_shipping_threshold_kurus=$2,updated_at=now(),updated_by=$3 WHERE id=true',[Math.round(input.data.fee*100),Math.round(input.data.threshold*100),admin.id]);
 revalidatePath('/','layout'); redirect('/yonetim/fiyatlandirma?saved=1');
}
export async function saveService(form:FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid(),discount:z.coerce.number().int().min(0).max(50),approved:z.enum(['true','false'])}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/servisler?error=1');
 await db.query("UPDATE accounts SET discount_percent=$2,approved=$3 WHERE id=$1 AND role='service'",[input.data.id,input.data.discount,input.data.approved==='true']);
 revalidatePath('/yonetim','layout'); redirect('/yonetim/servisler?saved=1');
}
export async function changeOrderStatus(form:FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid(),status:z.enum(['confirmed','shipped','cancelled']),back:orderListBack.optional()}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect(orderListReturn(form.get('back'),'error'));
 const ok=await transitionOrder(input.data.id,input.data.status);
 revalidateOrder(input.data.id);
 redirect(orderListReturn(input.data.back,ok ? 'saved' : 'error'));
}
export async function recordRefund(form:FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid(),reference:z.string().trim().min(3).max(120),back:orderListBack.optional()}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect(orderListReturn(form.get('back'),'error'));
 const ok=await recordOrderRefund(input.data.id,input.data.reference);
 revalidateOrder(input.data.id);
 redirect(orderListReturn(input.data.back,ok ? 'saved' : 'error'));
}
// The admin panel (lists, sidebar counts, dashboard) and the customer's own order pages; nothing else shows order state.
function revalidateOrder(id:string) {
 revalidatePath('/yonetim','layout');revalidatePath(`/siparis/${id}`);revalidatePath('/siparisler');
}
/** Shipped lines only; partial returns may add up to the ordered quantity. */
export async function recordReturn(form:FormData) {
 const admin=await requireAdmin();
 const input=z.object({orderId:z.uuid(),productId:z.uuid(),quantity:z.coerce.number().int().min(1).max(99),reason:z.enum(returnReasons),note:z.string().trim().max(500)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/siparisler?error=1');
 const {orderId,productId,quantity,reason,note}=input.data;
 const client=await db.connect();
 let ok=false;
 try {
  await client.query('BEGIN');
  const line=(await client.query<{quantity:number;returned:number}>(`SELECT i.quantity,COALESCE((SELECT sum(r.quantity) FROM commerce_returns r WHERE r.order_id=i.order_id AND r.product_id=i.product_id),0)::integer AS returned
   FROM commerce_order_items i JOIN commerce_orders o ON o.id=i.order_id WHERE i.order_id=$1 AND i.product_id=$2 AND o.status='shipped' FOR UPDATE OF i`,[orderId,productId])).rows[0];
  if(line && line.returned+quantity<=line.quantity) {
   await client.query('INSERT INTO commerce_returns(order_id,product_id,quantity,reason,note,created_by) VALUES($1,$2,$3,$4,$5,$6)',[orderId,productId,quantity,reason,note,admin.id]);ok=true;
  }
  await client.query('COMMIT');
 } catch(error) { await client.query('ROLLBACK');throw error; }
 finally {client.release();}
 revalidatePath(`/siparis/${orderId}`);revalidatePath('/yonetim/siparisler');
 redirect(`/siparis/${orderId}?iade=${ok ? 'kaydedildi' : 'hata'}`);
}
