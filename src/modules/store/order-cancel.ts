import "server-only";
import type { PoolClient } from "pg";
import { releaseReservedStock } from "./stock-reservation";

// Shared by admin cancel, payment expiry and customer cancel (#607). Kept free of the payments module to avoid cycles.
export type CancelActor = "customer" | "admin" | "expiry";

/**
 * Cancels an order whose row the caller holds FOR UPDATE: returns its reserved store stock and records who cancelled.
 * A paid order then waits for a refund; an unpaid online order is marked expired (window passed) or cancelled (by hand).
 */
export async function cancelLockedOrder(client: PoolClient, orderId: string, by: CancelActor) {
  await releaseReservedStock(client, orderId);
  await client.query(`UPDATE commerce_orders SET status='cancelled',cancelled_by=$2,cancelled_at=now(),
    payment_status=CASE payment_status WHEN 'paid' THEN 'refund_required' WHEN 'awaiting' THEN $3 ELSE payment_status END WHERE id=$1`,
  [orderId, by, by === "expiry" ? "expired" : "cancelled"]);
}
