import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentAccount } from "@/modules/auth/session";
import { currentCartOwner, currentGuestCartOwner } from "./cart";
import type { CommerceOrder, OrderItem } from "./orders";
import type { OrderAgreementDocument } from "./order-agreement";

export const orderColumns="id,number,owner_kind,owner_id,customer_name,email,phone,address,note,total_kurus,subtotal_kurus,shipping_kurus,discount_percent,status,created_at,payment_status,payment_due_at,paid_at,payment_note,refund_reference,carrier,carrier_name,tracking_no,tracking_url,shipped_at,delivered_at";

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
 const [items,agreement]=await Promise.all([
  db.query<OrderItem>("SELECT product_id,name,code,quantity,unit_price_kurus,pricing_snapshot,vehicle,fitment_level FROM commerce_order_items WHERE order_id=$1 ORDER BY code,product_id",[id]),
  db.query<{accepted_at:Date;legal_version:string}>("SELECT accepted_at,legal_version FROM commerce_order_agreements WHERE order_id=$1",[id]),
 ]);
 return {order,items:items.rows,agreement:agreement.rows[0] ?? null};
}

/** The order's stored pre-contract copy, under the same access rule as the order page; null when none was recorded. */
export async function currentOrderAgreement(id:string) {
 const result=await currentOrder(id);
 if(!result) return null;
 const agreement=(await db.query<{accepted_at:Date;legal_version:string;consent_text:string;document:OrderAgreementDocument}>(
  "SELECT accepted_at,legal_version,consent_text,document FROM commerce_order_agreements WHERE order_id=$1",[id])).rows[0];
 return agreement ? {order:result.order,agreement} : null;
}
