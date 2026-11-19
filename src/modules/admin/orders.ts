import "server-only";
// Callers check the admin session (commerce-actions.ts); kept free of it so tests can run the transitions.
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { cancelWithNote } from "@/modules/store/customer-cancel";
import { cancelLockedOrder } from "@/modules/store/order-cancel";
import { isHandledPayment } from "@/modules/store/payment-states";
import { resolveTrackingUrl, type Shipment } from "@/modules/store/shipment";
import { openCancelRequestSql } from "./order-filters";
import type { ProcurementStatus } from "./order-procurement";

// Shipping is its own step (shipOrder): it needs the carrier and tracking number. delivered is final.
type OrderTransition = "confirmed" | "cancelled" | "delivered";
const allowed: Record<string, OrderTransition[]> = { pending: ["confirmed", "cancelled"], confirmed: ["cancelled"], shipped: ["delivered"] };

type HandledOrder = { status: string; payment_status: string; cancel_request_open: boolean };

/** Runs `step` on a locked order that operations may handle; false when it is missing or `step` refuses it. */
async function withHandledOrder(id: string, step: (client: PoolClient, old: HandledOrder) => Promise<boolean>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const old = (await client.query<HandledOrder>(`SELECT o.status,o.payment_status,${openCancelRequestSql} AS cancel_request_open
      FROM commerce_orders o WHERE o.id=$1 FOR UPDATE`, [id])).rows[0];
    // Unpaid online orders expire on their own; operations only handle paid, legacy offline or partner on-account (#426) orders.
    const ok = old && isHandledPayment(old.payment_status) ? await step(client, old) : false;
    await client.query("COMMIT");
    return ok;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Operations' order steps. Returns false when the order is missing or the step is not allowed from its state. */
export async function transitionOrder(id: string, status: OrderTransition) {
  return withHandledOrder(id, async (client, old) => {
    if (!allowed[old.status]?.includes(status)) return false;
    // A paid order then waits for a TAMI refund (Siparişler → TAMI'den iade et, or a manually recorded reference).
    if (status === "cancelled") { await cancelLockedOrder(client, id, "admin"); return true; }
    await client.query("UPDATE commerce_orders SET status=$2,delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END WHERE id=$1", [id, status]);
    return true;
  });
}

/**
 * Operations' answer to a partner's cancel request (#426) on a confirmed order: `approve` cancels it on the partner's
 * behalf (cancelled_by 'customer', noted like the partner's own cancel), `reject` keeps it for shipping and is final.
 * False when the order is not confirmed or has no open request.
 */
export async function decidePartnerCancelRequest(id: string, decision: "approve" | "reject") {
  return withHandledOrder(id, async (client, old) => {
    if (old.status !== "confirmed" || !old.cancel_request_open) return false;
    if (decision === "approve") await cancelWithNote(client, id, "Partnerin iptal talebi onaylandı.");
    else await client.query("UPDATE commerce_orders SET cancel_request_rejected_at=now() WHERE id=$1", [id]);
    return true;
  });
}

const shipmentValues = (shipment: Shipment) =>
  [shipment.carrier, shipment.carrierName, shipment.trackingNo, resolveTrackingUrl(shipment.carrier, shipment.trackingNo, shipment.trackingUrl)];

/** Hands a confirmed order to the carrier; false unless it was confirmed (and paid or offline) without an open cancel request. */
export async function shipOrder(id: string, shipment: Shipment) {
  return withHandledOrder(id, async (client, old) => {
    if (old.status !== "confirmed" || old.cancel_request_open) return false;
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

export type LineProcurementInput = { orderId: string; productId: string; status: ProcurementStatus; reference: string; adminId: string };
/**
 * Procurement of one supplier line (#606), freely between pending, ordered and procured while the order is pending or
 * confirmed (and paid or offline). The reference is what was submitted (blank clears it; pending always clears it).
 * The order time is set by the ordered step only (kept afterwards), so a line procured straight from pending has none.
 */
export async function setLineProcurement({ orderId, productId, status, reference, adminId }: LineProcurementInput) {
  return withHandledOrder(orderId, async (client, old) => {
    if (!["pending", "confirmed"].includes(old.status)) return false;
    const updated = await client.query(`UPDATE commerce_order_items SET procurement_status=$3,
      procurement_ref=CASE WHEN $3='pending' THEN NULL ELSE NULLIF(btrim($4),'') END,
      procurement_ordered_at=CASE WHEN $3='pending' THEN NULL WHEN $3='ordered' THEN COALESCE(procurement_ordered_at,now()) ELSE procurement_ordered_at END,
      procured_at=CASE WHEN $3='procured' THEN COALESCE(procured_at,now()) END,procurement_by=$5
      WHERE order_id=$1 AND product_id=$2 AND COALESCE(pricing_snapshot->>'source','')<>'store'`, [orderId, productId, status, reference, adminId]);
    return Boolean(updated.rowCount);
  });
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
