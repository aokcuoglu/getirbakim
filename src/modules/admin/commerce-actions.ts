'use server';
import { requireAdmin } from '@/modules/auth/session';
import { db } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { returnReasons } from '@/modules/store/returns';
import { shipmentSchema,type ShipmentResult } from '@/modules/store/shipment';
import { transitionOrder,recordOrderRefund,shipOrder,updateShipment,recordOrderReturn,setLineProcurement } from './orders';
import { procurementInput } from './order-procurement';
import { orderListBack,orderListReturn,type OrderListOutcome } from './order-list-return';
import { refundPayment,checkRefund,type RefundOutcome } from '@/modules/payments/refunds';
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
 const input=z.object({id:z.uuid(),status:z.enum(['confirmed','cancelled','delivered']),back:orderListBack.optional()}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect(orderListReturn(form.get('back'),'error'));
 const ok=await transitionOrder(input.data.id,input.data.status);
 revalidateOrder(input.data.id);
 redirect(orderListReturn(input.data.back,ok ? 'saved' : 'error'));
}
/**
 * Ship dialog (#605): `ship` hands a confirmed order to the carrier, `edit` corrects the details of a shipped one.
 * The dialog closes itself on success and opens `next`; a malformed `back` only loses the list position (orderListReturn).
 */
export async function saveShipment(_previous:ShipmentResult,form:FormData):Promise<ShipmentResult> {
 await requireAdmin();
 const values=Object.fromEntries(form);
 const target=z.object({id:z.uuid(),mode:z.enum(['ship','edit'])}).safeParse(values);
 const shipment=shipmentSchema.safeParse(values);
 if(!target.success) return {status:'error',message:'Sipariş bulunamadı. Listeyi yenileyin.'};
 if(!shipment.success) return {status:'error',errors:shipment.error.flatten().fieldErrors};
 const ok=target.data.mode==='ship' ? await shipOrder(target.data.id,shipment.data) : await updateShipment(target.data.id,shipment.data);
 if(!ok) return {status:'error',message:'Sipariş bu işlem için uygun değil. Listeyi yenileyin.'};
 revalidateOrder(target.data.id);
 return {status:'success',next:orderListReturn(form.get('back'),'saved')};
}
export type ProcurementResult={status:'idle'|'success'|'error';message?:string};
/** Procurement status of one order line (#606); the lines dialog stays open and shows the refreshed list. */
export async function saveLineProcurement(_previous:ProcurementResult,form:FormData):Promise<ProcurementResult> {
 const admin=await requireAdmin();
 const input=procurementInput.safeParse(Object.fromEntries(form));
 if(!input.success) return {status:'error',message:'Tedarik bilgisi geçersiz. Referans en fazla 200 karakter olabilir.'};
 const ok=await setLineProcurement({orderId:input.data.order,productId:input.data.product,status:input.data.status,reference:input.data.reference,adminId:admin.id});
 if(!ok) return {status:'error',message:'Sipariş bu işlem için uygun değil. Listeyi yenileyin.'};
 revalidatePath('/yonetim','layout');
 return {status:'success'};
}
export async function recordRefund(form:FormData) {
 await requireAdmin();
 const input=z.object({id:z.uuid(),reference:z.string().trim().min(3).max(120),back:orderListBack.optional()}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect(orderListReturn(form.get('back'),'error'));
 const ok=await recordOrderRefund(input.data.id,input.data.reference);
 revalidateOrder(input.data.id);
 redirect(orderListReturn(input.data.back,ok ? 'saved' : 'error'));
}
const refundOutcome:Record<RefundOutcome['outcome'],OrderListOutcome>={succeeded:'refunded',failed:'refund_failed',unknown:'refund_unknown',busy:'refund_busy',not_allowed:'error',unavailable:'refund_unavailable'};
const refundReturn=(result:RefundOutcome):OrderListOutcome=>result.outcome==='failed' && result.kind==='void' ? 'refund_void_failed' : refundOutcome[result.outcome];
/** A TAMI call whose result could not be handled is shown as unknown; its row (if any) stays and locks new calls. */
async function settledOrUnknown(run:()=>Promise<RefundOutcome>):Promise<OrderListOutcome> {
 try { return refundReturn(await run()); }
 catch(error) { console.error('TAMI refund action failed',{error:error instanceof Error ? error.message : error}); return 'refund_unknown'; }
}
/** Full void/refund of one captured payment attempt through the TAMI API (#619); the outcome is shown on the list. */
export async function refundViaTami(form:FormData) {
 const admin=await requireAdmin();
 const input=z.object({order:z.uuid(),payment:z.uuid(),back:orderListBack.optional()}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect(orderListReturn(form.get('back'),'error'));
 const outcome=await settledOrUnknown(()=>refundPayment({orderId:input.data.order,paymentId:input.data.payment,adminId:admin.id}));
 revalidateOrder(input.data.order);
 redirect(orderListReturn(input.data.back,outcome));
}
/** Settles a TAMI call whose reply was lost or unverifiable, from the signed order query. */
export async function checkTamiRefund(form:FormData) {
 await requireAdmin();
 const input=z.object({refund:z.uuid(),order:z.uuid(),back:orderListBack.optional()}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect(orderListReturn(form.get('back'),'error'));
 const outcome=await settledOrUnknown(()=>checkRefund({refundId:input.data.refund,orderId:input.data.order}));
 revalidateOrder(input.data.order);
 redirect(orderListReturn(input.data.back,outcome));
}
// The admin panel (lists, sidebar counts, dashboard) and the customer's own order pages; nothing else shows order state.
function revalidateOrder(id:string) {
 revalidatePath('/yonetim','layout');revalidatePath(`/siparis/${id}`);revalidatePath('/siparisler');
}
/** Shipped or delivered lines; partial returns may add up to the ordered quantity. */
export async function recordReturn(form:FormData) {
 const admin=await requireAdmin();
 const input=z.object({orderId:z.uuid(),productId:z.uuid(),quantity:z.coerce.number().int().min(1).max(99),reason:z.enum(returnReasons),note:z.string().trim().max(500)}).safeParse(Object.fromEntries(form));
 if(!input.success) redirect('/yonetim/siparisler?error=1');
 const ok=await recordOrderReturn({...input.data,adminId:admin.id});
 revalidatePath(`/siparis/${input.data.orderId}`);revalidatePath('/yonetim/siparisler');
 redirect(`/siparis/${input.data.orderId}?iade=${ok ? 'kaydedildi' : 'hata'}`);
}
