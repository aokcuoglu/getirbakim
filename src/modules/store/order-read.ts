import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentAccount } from "@/modules/auth/session";
import { currentCartOwner, currentGuestCartOwner, type CartOwner } from "./cart";
import type { CommerceOrder, OrderItem } from "./orders";
import type { OrderAgreementDocument } from "./order-agreement";

export const orderColumns="id,number,owner_kind,owner_id,customer_name,email,phone,address,note,total_kurus,subtotal_kurus,shipping_kurus,discount_percent,status,created_at,payment_status,payment_due_at,paid_at,payment_note,refund_reference,refunded_at,carrier,carrier_name,tracking_no,tracking_url,shipped_at,delivered_at,cancelled_by,cancelled_at";

/** Every owner whose orders the visitor may see: the account (or guest cart) and the guest cart of this browser. */
export async function currentOrderOwners():Promise<CartOwner[]> {
 const [owner,guest]=await Promise.all([currentCartOwner(),currentGuestCartOwner()]);
 if(!owner) return [];
 return guest && (guest.kind!==owner.kind || guest.id!==owner.id) ? [owner,guest] : [owner];
}

export async function currentOrders() {
 const [owner,guest]=await Promise.all([currentCartOwner(),currentGuestCartOwner()]);
 if(!owner) return [];
 return (await db.query<Pick<CommerceOrder,'id'|'number'|'status'|'payment_status'|'total_kurus'|'created_at'|'carrier'|'carrier_name'|'tracking_no'|'tracking_url'|'shipped_at'|'delivered_at'>>(
  "SELECT id,number,status,payment_status,total_kurus,created_at,carrier,carrier_name,tracking_no,tracking_url,shipped_at,delivered_at FROM commerce_orders WHERE (owner_kind=$1 AND owner_id=$2) OR (owner_kind='guest' AND owner_id=$3) ORDER BY created_at DESC,id DESC LIMIT 100",
  [owner.kind,owner.id,guest?.id ?? ''],
 )).rows;
}

export async function currentOrder(id:string) {
 if(!z.uuid().safeParse(id).success) return null;
 const [owner,guest,account]=await Promise.all([currentCartOwner(),currentGuestCartOwner(),currentAccount()]);
 if(!owner) return null;
 const order=(await db.query<CommerceOrder>(
  `SELECT ${orderColumns} FROM commerce_orders WHERE id=$1 AND ($2 OR (owner_kind=$3 AND owner_id=$4) OR (owner_kind='guest' AND owner_id=$5))`,
  [id,account?.approved && account.role==='admin' || false,owner.kind,owner.id,guest?.id ?? ''],
 )).rows[0];
 if(!order) return null;
 const isAdmin=Boolean(account?.approved && account.role==='admin');
 const [items,adminLines,agreement]=await Promise.all([
  // Only what the customer's page reads from the snapshot (#606): supplier, warehouse and cost stay in the admin panel.
  db.query<OrderItem>(`SELECT product_id,name,code,quantity,unit_price_kurus,
   jsonb_build_object('checkout_mode',pricing_snapshot->'checkout_mode','observed_at',pricing_snapshot->'observed_at') AS pricing_snapshot,
   vehicle,fitment_level FROM commerce_order_items WHERE order_id=$1 ORDER BY code,product_id`,[id]),
  // Admin only (#766): which supplier a snapshot line came from and whether its live check failed.
  isAdmin ? db.query<{product_id:string;supplier:string|null;live_check:unknown;live_check_reason:unknown}>(`SELECT product_id,supplier,pricing_snapshot->'live_check' AS live_check,pricing_snapshot->'live_check_reason' AS live_check_reason FROM commerce_order_items WHERE order_id=$1`,[id]) : null,
  db.query<{accepted_at:Date;legal_version:string}>("SELECT accepted_at,legal_version FROM commerce_order_agreements WHERE order_id=$1",[id]),
 ]);
 // false when an admin opens someone else's order: only the order's own customer may cancel it.
 const mine=(order.owner_kind===owner.kind && order.owner_id===owner.id) || (order.owner_kind==='guest' && order.owner_id===guest?.id);
 const lineDetail=new Map((adminLines?.rows ?? []).map(row=>[row.product_id,row]));
 return {order,items:items.rows.map(item=>{const d=lineDetail.get(item.product_id); return d ? {...item,supplier:d.supplier,pricing_snapshot:{...item.pricing_snapshot,live_check:d.live_check,live_check_reason:d.live_check_reason}} : {...item,supplier:null as string|null};}),agreement:agreement.rows[0] ?? null,mine};
}

/** The order's stored pre-contract copy, under the same access rule as the order page; null when none was recorded. */
export async function currentOrderAgreement(id:string) {
 const result=await currentOrder(id);
 if(!result) return null;
 const agreement=(await db.query<{accepted_at:Date;legal_version:string;consent_text:string;document:OrderAgreementDocument}>(
  "SELECT accepted_at,legal_version,consent_text,document FROM commerce_order_agreements WHERE order_id=$1",[id])).rows[0];
 return agreement ? {order:result.order,agreement} : null;
}

/** Sum of TAMI reversals confirmed for an order (#619); null when none (refunded by hand or before #619). Call after currentOrder. */
export async function orderRefundedKurus(id:string) {
 const total=(await db.query<{total:string|null}>("SELECT sum(amount_kurus)::text AS total FROM commerce_payment_refunds WHERE order_id=$1 AND status='succeeded'",[id])).rows[0]?.total;
 return total ? Number(total) : null;
}
