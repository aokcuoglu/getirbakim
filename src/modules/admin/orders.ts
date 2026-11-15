import "server-only";
// Callers check the admin session (commerce-actions.ts); kept free of it so tests can run the transitions.
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { releaseReservedStock } from "@/modules/store/stock-reservation";
import { resolveTrackingUrl, type Shipment } from "@/modules/store/shipment";

// Shipping is its own step (shipOrder): it needs the carrier and tracking number. delivered is final.
type OrderTransition = "confirmed" | "cancelled" | "delivered";
const allowed: Record<string, OrderTransition[]> = { pending: ["confirmed", "cancelled"], confirmed: ["cancelled"], shipped: ["delivered"] };

/** Runs `step` on a locked order that operations may handle; false when it is missing or `step` refuses it. */
async function withHandledOrder(id: string, step: (client: PoolClient, old: { status: string; payment_status: string }) => Promise<boolean>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const old = (await client.query<{ status: string; payment_status: string }>("SELECT status,payment_status FROM commerce_orders WHERE id=$1 FOR UPDATE", [id])).rows[0];
    // Unpaid online orders expire on their own; operations only handle paid (or legacy offline) orders.
    const ok = old && ["paid", "none"].includes(old.payment_status) ? await step(client, old) : false;
    await client.query("COMMIT");
    return ok;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Operations' order steps. Returns false when the order is missing or the step is not allowed from its state. */
export async function transitionOrder(id: string, status: OrderTransition) {
  return withHandledOrder(id, async (client, old) => {
    if (!allowed[old.status]?.includes(status)) return false;
    if (status === "cancelled") await releaseReservedStock(client, id);
    // The order waits for a TAMI refund (Siparişler → TAMI'den iade et, or a manually recorded reference).
    await client.query(`UPDATE commerce_orders SET status=$2,payment_status=CASE WHEN $2='cancelled' AND payment_status='paid' THEN 'refund_required' ELSE payment_status END,
      delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END WHERE id=$1`, [id, status]);
    return true;
  });
}

const shipmentValues = (shipment: Shipment) =>
  [shipment.carrier, shipment.carrierName, shipment.trackingNo, resolveTrackingUrl(shipment.carrier, shipment.trackingNo, shipment.trackingUrl)];

/** Hands a confirmed order to the carrier; false unless it was confirmed (and paid or offline). */
export async function shipOrder(id: string, shipment: Shipment) {
  return withHandledOrder(id, async (client, old) => {
    if (old.status !== "confirmed") return false;
    await client.query("UPDATE commerce_orders SET status='shipped',shipped_at=now(),carrier=$2,carrier_name=$3,tracking_no=$4,tracking_url=$5 WHERE id=$1",
      [id, ...shipmentValues(shipment)]);
    return true;
  });
}

/** Corrects (or, on orders shipped before #605, adds) the carrier details while the order is on its way. */
export async function updateShipment(id: string, shipment: Shipment) {
  const updated = await db.query("UPDATE commerce_orders SET carrier=$2,carrier_name=$3,tracking_no=$4,tracking_url=$5 WHERE id=$1 AND status='shipped'",
    [id, ...shipmentValues(shipment)]);
  return Boolean(updated.rowCount);
}

/**
 * Manual fallback to the TAMI API refund (#619): records a reference of a refund made elsewhere (TAMI portal, or a call
 * whose reply was lost). False unless a refund was pending; refund call rows are left as they are.
 */
export async function recordOrderRefund(id: string, reference: string) {
  const updated = await db.query("UPDATE commerce_orders SET payment_status='refunded',refund_reference=$2,refunded_at=now() WHERE id=$1 AND payment_status='refund_required'", [id, reference]);
  return Boolean(updated.rowCount);
}

export type OrderReturnInput = { orderId: string; productId: string; quantity: number; reason: string; note: string; adminId: string };
/** Shipped or delivered lines only; partial returns may add up to the ordered quantity. */
export async function recordOrderReturn({ orderId, productId, quantity, reason, note, adminId }: OrderReturnInput) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const line = (await client.query<{ quantity: number }>(`SELECT i.quantity FROM commerce_order_items i JOIN commerce_orders o ON o.id=i.order_id
     WHERE i.order_id=$1 AND i.product_id=$2 AND o.status IN ('shipped','delivered') FOR UPDATE OF i`, [orderId, productId])).rows[0];
    // Summed in its own statement, after the lock: a snapshot taken before waiting would miss a return committed meanwhile.
    const returned = line ? (await client.query<{ returned: number }>("SELECT COALESCE(sum(quantity),0)::integer AS returned FROM commerce_returns WHERE order_id=$1 AND product_id=$2",
      [orderId, productId])).rows[0].returned : 0;
    const ok = Boolean(line && returned + quantity <= line.quantity);
    if (ok) await client.query("INSERT INTO commerce_returns(order_id,product_id,quantity,reason,note,created_by) VALUES($1,$2,$3,$4,$5,$6)", [orderId, productId, quantity, reason, note, adminId]);
    await client.query("COMMIT");
    return ok;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
