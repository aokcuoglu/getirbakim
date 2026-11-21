import "server-only";
import type { PoolClient } from "pg";
import { queueOrderEmail } from "./order-email-queue";
import { releaseReservedStock } from "./stock-reservation";

// Shared by admin cancel, payment expiry and customer cancel (#607). Kept free of the payments module to avoid cycles.
export type CancelActor = "customer" | "admin" | "expiry";

/**
 * Cancels an order whose row the caller holds FOR UPDATE: returns its reserved store stock and records who cancelled.
 * A paid order then waits for a refund; an unpaid online order is marked expired (window passed) or cancelled (by hand).
 * Only an accepted order (paid, now refund_required, or legacy offline 'none') gets the cancel email (#1036): an
 * unpaid order never became one, so its customer is not written to.
 */
export async function cancelLockedOrder(client: PoolClient, orderId: string, by: CancelActor) {
  await releaseReservedStock(client, orderId);
  const updated = await client.query<{ payment_status: string }>(`UPDATE commerce_orders SET status='cancelled',cancelled_by=$2,cancelled_at=now(),
    payment_status=CASE payment_status WHEN 'paid' THEN 'refund_required' WHEN 'awaiting' THEN $3 ELSE payment_status END WHERE id=$1
    RETURNING payment_status`,
  [orderId, by, by === "expiry" ? "expired" : "cancelled"]);
  const payment = updated.rows[0]?.payment_status;
  if (by !== "expiry" && (payment === "refund_required" || payment === "none")) await queueOrderEmail(client, orderId, "cancelled");
}
