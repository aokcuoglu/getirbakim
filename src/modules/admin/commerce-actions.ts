'use server';
import { requireAdmin } from '@/modules/auth/session';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
export async function savePricing(form:FormData) {
 const admin=await requireAdmin();
 const input=z.object({markup:z.coerce.number().min(0).max(1000).multipleOf(0.01),vat:z.coerce.number().min(0).max(100).multipleOf(0.01),age:z.coerce.number().int().min(1).max(168)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/fiyatlandirma?error=1');
 await db.query('UPDATE commerce_settings SET markup_percent=$1,vat_percent=$2,max_age_hours=$3,updated_at=now(),updated_by=$4 WHERE id=true',[input.data.markup,input.data.vat,input.data.age,admin.id]);
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
  const old=(await client.query<{status:string}>('SELECT status FROM commerce_orders WHERE id=$1 FOR UPDATE',[input.data.id])).rows[0];
  const allowed:Record<string,string[]>={pending:['confirmed','cancelled'],confirmed:['shipped','cancelled']};
  if(old && allowed[old.status]?.includes(input.data.status)) {
   if(input.data.status==='cancelled') {
    // Only in-house stock was reserved; supplier signals are never decremented.
    await client.query(`UPDATE products p SET stock=p.stock+i.quantity,updated_at=now() FROM commerce_order_items i WHERE i.order_id=$1 AND i.product_id=p.id`,[input.data.id]);
   }
   await client.query('UPDATE commerce_orders SET status=$2 WHERE id=$1',[input.data.id,input.data.status]);ok=true;
  }
  await client.query('COMMIT');
 } catch(error) { await client.query('ROLLBACK');throw error; }
 finally {client.release();}
 revalidatePath('/','layout');redirect(ok ? '/yonetim/siparisler?saved=1' : '/yonetim/siparisler?error=1');
}
