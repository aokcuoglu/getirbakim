import "server-only";
// Callers check the admin session (commerce-actions.ts); kept free of it so tests can run the transitions.
import { db } from "@/lib/db";
import { releaseReservedStock } from "@/modules/store/stock-reservation";

type OrderTransition = "confirmed" | "shipped" | "cancelled";
const allowed: Record<string, OrderTransition[]> = { pending: ["confirmed", "cancelled"], confirmed: ["shipped", "cancelled"] };

/** Operations' order steps. Returns false when the order is missing or the step is not allowed from its state. */
export async function transitionOrder(id: string, status: OrderTransition) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const old = (await client.query<{ status: string; payment_status: string }>("SELECT status,payment_status FROM commerce_orders WHERE id=$1 FOR UPDATE", [id])).rows[0];
    // Unpaid online orders expire on their own; operations only handle paid (or legacy offline) orders.
    if (!old || !["paid", "none"].includes(old.payment_status) || !allowed[old.status]?.includes(status)) {
      await client.query("COMMIT");
      return false;
    }
    if (status === "cancelled") await releaseReservedStock(client, id);
    // Refunds are made in the TAMI portal; the order waits until its reference is recorded.
    await client.query(`UPDATE commerce_orders SET status=$2,payment_status=CASE WHEN $2='cancelled' AND payment_status='paid' THEN 'refund_required' ELSE payment_status END WHERE id=$1`, [id, status]);
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Records the TAMI refund reference of a cancelled paid order; false unless a refund was pending. */
export async function recordOrderRefund(id: string, reference: string) {
  const updated = await db.query("UPDATE commerce_orders SET payment_status='refunded',refund_reference=$2 WHERE id=$1 AND payment_status='refund_required'", [id, reference]);
  return Boolean(updated.rowCount);
}
