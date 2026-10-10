'use server';
import { requireAdmin } from '@/modules/auth/session';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { returnReasons } from '@/modules/store/returns';
export async function savePricing(form:FormData) {
 const admin=await requireAdmin();
 const input=z.object({markup:z.coerce.number().min(0).max(1000).multipleOf(0.01),vat:z.coerce.number().min(0).max(100).multipleOf(0.01),age:z.coerce.number().int().min(1).max(168)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/fiyatlandirma?error=1');
 await db.query('UPDATE commerce_settings SET markup_percent=$1,vat_percent=$2,max_age_hours=$3,updated_at=now(),updated_by=$4 WHERE id=true',[input.data.markup,input.data.vat,input.data.age,admin.id]);
 revalidatePath('/','layout'); redirect('/yonetim/fiyatlandirma?saved=1');
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
 revalidatePath('/','layout'); redirect('/yonetim/servisler?saved=1');
}
export async function changeOrderStatus(form:FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid(),status:z.enum(['confirmed','shipped','cancelled'])}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/siparisler?error=1');
 const client=await db.connect();
 let ok=false;
 try {
  await client.query('BEGIN');
  const old=(await client.query<{status:string;payment_status:string}>('SELECT status,payment_status FROM commerce_orders WHERE id=$1 FOR UPDATE',[input.data.id])).rows[0];
  const allowed:Record<string,string[]>={pending:['confirmed','cancelled'],confirmed:['shipped','cancelled']};
  // Unpaid online orders expire on their own; operations only handle paid (or legacy offline) orders.
  if(old && ['paid','none'].includes(old.payment_status) && allowed[old.status]?.includes(input.data.status)) {
   if(input.data.status==='cancelled') {
    // Only in-house stock was reserved; supplier signals are never decremented.
    await client.query(`UPDATE products p SET stock=p.stock+i.quantity,updated_at=now() FROM commerce_order_items i WHERE i.order_id=$1 AND i.product_id=p.id`,[input.data.id]);
   }
   // Refunds are made in the TAMI portal; the order waits until its reference is recorded.
   await client.query(`UPDATE commerce_orders SET status=$2,payment_status=CASE WHEN $2='cancelled' AND payment_status='paid' THEN 'refund_required' ELSE payment_status END WHERE id=$1`,[input.data.id,input.data.status]);ok=true;
  }
  await client.query('COMMIT');
 } catch(error) { await client.query('ROLLBACK');throw error; }
 finally {client.release();}
 revalidatePath('/','layout');redirect(ok ? '/yonetim/siparisler?saved=1' : '/yonetim/siparisler?error=1');
}
export async function recordRefund(form:FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid(),reference:z.string().trim().min(3).max(120)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/siparisler?error=1');
 const updated=await db.query("UPDATE commerce_orders SET payment_status='refunded',refund_reference=$2 WHERE id=$1 AND payment_status='refund_required'",[input.data.id,input.data.reference]);
 revalidatePath('/','layout');redirect(updated.rowCount ? '/yonetim/siparisler?saved=1' : '/yonetim/siparisler?error=1');
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
