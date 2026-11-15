import "server-only";
// Callers resolve the customer's owners from the session (order-read.ts); kept free of it so tests can run it.
import { db } from "@/lib/db";
import { appendNote, reconcileOrderPayments } from "@/modules/payments/checkout";
import type { CartOwner } from "./cart";
import { cancelLockedOrder } from "./order-cancel";

/**
 * cancelled: unpaid order cancelled · refund: paid order cancelled, refund pending · already: the customer had cancelled it ·
 * paid: a payment arrived meanwhile, nothing cancelled · unverified: TAMI gave no definite answer, nothing cancelled ·
 * closed: the order can no longer be cancelled here · missing: no such order among the customer's.
 */
export type CustomerCancelResult = "cancelled" | "refund" | "already" | "paid" | "unverified" | "closed" | "missing";
/** The order status the customer saw when asking; a different one under the lock means the page was stale. */
export type CancelExpectation = "awaiting_payment" | "pending";

type LockedOrder = { status: string; payment_status: string; cancelled_by: string | null };

/**
 * Customer cancel (#607): an order awaiting payment, or a pending (not yet confirmed) paid or offline one.
 * Open TAMI attempts are queried first; an attempt without a definite answer may hide a payment, so nothing is cancelled.
 */
export async function cancelOrderByCustomer(orderId: string, owners: CartOwner[], expected: CancelExpectation): Promise<CustomerCancelResult> {
  const owned = (await db.query<{ owner_kind: string; owner_id: string; payment_status: string }>(
    "SELECT owner_kind,owner_id,payment_status FROM commerce_orders WHERE id=$1", [orderId],
  )).rows[0];
  // Strangers learn nothing and cause no provider call.
  if (!owned || !owners.some(owner => owner.kind === owned.owner_kind && owner.id === owned.owner_id)) return "missing";
  const uncertain = owned.payment_status === "awaiting" ? (await reconcileOrderPayments(orderId)).uncertain : false;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Same lock as recordPaid, so a payment being recorded and this cancel never interleave.
    const order = (await client.query<LockedOrder>(
      "SELECT status,payment_status,cancelled_by FROM commerce_orders WHERE id=$1 FOR UPDATE", [orderId],
    )).rows[0];
    let result: CustomerCancelResult = "closed";
    if (order?.status === "cancelled" && order.cancelled_by === "customer") result = "already";
    else if (order?.status === "awaiting_payment" && order.payment_status === "awaiting") {
      if (expected !== "awaiting_payment") result = "closed";
      else if (uncertain) result = "unverified";
      else if ((await client.query("SELECT 1 FROM commerce_payments WHERE order_id=$1 AND status='succeeded'", [orderId])).rowCount) result = "paid";
      else { await cancelLockedOrder(client, orderId, "customer"); result = "cancelled"; }
    } else if (order?.status === "pending" && ["paid", "none"].includes(order.payment_status)) {
      // Paid while the customer looked at the unpaid page: tell them first instead of cancelling a paid order unasked.
      if (expected === "awaiting_payment") result = "paid";
      else {
        const procurement = (await client.query<{ ordered: number; procured: number }>(`SELECT count(*) FILTER (WHERE procurement_status='ordered')::int AS ordered,
          count(*) FILTER (WHERE procurement_status='procured')::int AS procured FROM commerce_order_items
          WHERE order_id=$1 AND COALESCE(pricing_snapshot->>'source','')<>'store'`, [orderId])).rows[0];
        await cancelLockedOrder(client, orderId, "customer");
        const notes = ["Müşteri iptal etti."];
        if (procurement.ordered || procurement.procured) {
          notes.push(`İptal anında ${procurement.ordered} kalem tedarikçiye sipariş edilmiş / ${procurement.procured} kalem tedarik edilmişti; tedarikçi siparişini kontrol edin.`);
        }
        await appendNote(client, orderId, notes.join(" "));
        result = order.payment_status === "paid" ? "refund" : "cancelled";
      }
    }
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
