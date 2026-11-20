import "server-only";
// Callers resolve the customer's owners from the session (order-read.ts); kept free of it so tests can run it.
import { db } from "@/lib/db";
import { refund, type RefundEvent } from "@/modules/analytics/events";
import type { CartOwner } from "./cart";

// A cancelled order whose payment is being or has been returned in full, whose purchase was measured and whose refund was not.
const refundable = `status='cancelled' AND payment_status IN ('refund_required','refunded')
 AND purchase_tracked_at IS NOT NULL AND refund_tracked_at IS NULL`;

/**
 * The GA4 refund event of a cancelled paid order, handed out at most once (#750). One conditional UPDATE claims
 * `refund_tracked_at` and returns the amounts, so only the request that claimed it gets the payload. Null for strangers,
 * orders that are not cancelled with a refund, orders whose purchase was never measured and refunds already sent.
 */
export async function claimRefund(orderId: string, owners: CartOwner[]): Promise<RefundEvent | null> {
  if (!owners.length) return null;
  const order = (await db.query<{ number: string; subtotal_kurus: string; shipping_kurus: string }>(
    `UPDATE commerce_orders SET refund_tracked_at=now()
     WHERE id=$1 AND ${refundable} AND (owner_kind,owner_id) IN (SELECT * FROM unnest($2::text[],$3::text[]))
     RETURNING number::text,subtotal_kurus::text,shipping_kurus::text`,
    [orderId, owners.map(owner => owner.kind), owners.map(owner => owner.id)],
  )).rows[0];
  // Same definition as purchase: the installment fee is intentionally excluded from value (#894).
  return order ? refund({ transactionId: order.number, subtotalKurus: Number(order.subtotal_kurus), shippingKurus: Number(order.shipping_kurus) }) : null;
}

/** Whether the order page should mount the refund tracker; false when the read fails (e.g. before db:setup adds the column). */
export async function refundEventPending(orderId: string): Promise<boolean> {
  try {
    return (await db.query(`SELECT 1 FROM commerce_orders WHERE id=$1 AND ${refundable}`, [orderId])).rowCount === 1;
  } catch (error) {
    console.error("Refund event lookup failed", { orderId, error: error instanceof Error ? error.message : error });
    return false;
  }
}
