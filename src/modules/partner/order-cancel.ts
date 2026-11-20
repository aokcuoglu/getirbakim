import "server-only";
import { db } from "@/lib/db";
import { cancelWithNote } from "@/modules/store/customer-cancel";
import { notFound, readOrder, uuidPattern } from "./orders";
import { PartnerOrderError } from "./quotes";

/** CANCELLED: the order is cancelled (now or earlier) · REQUESTED: operations decide the partner's cancel request. */
export type PartnerCancellation = "CANCELLED" | "REQUESTED";

type LockedOrder = { status: string; cancel_requested_at: Date | null; cancel_request_rejected_at: Date | null };

/**
 * `DELETE /orders/:id` (#426): before confirmation the order is cancelled at once (cancelled_by 'customer', like a
 * customer's own cancel); after confirmation a cancel request is recorded for operations (/yonetim/siparisler). Repeating
 * it answers the same; a rejected request is final; a shipped order goes through returns with operations.
 */
export async function cancelPartnerOrder(partner: string, id: string) {
  if (!uuidPattern.test(id)) throw notFound();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Same row lock as the admin steps and payment handling, so a confirmation and this cancel never interleave.
    const order = (await client.query<LockedOrder>(
      "SELECT status,cancel_requested_at,cancel_request_rejected_at FROM commerce_orders WHERE id=$1 AND owner_kind='partner' AND owner_id=$2 FOR UPDATE",
      [id, partner])).rows[0];
    if (!order) throw notFound();
    let cancellation: PartnerCancellation;
    if (order.status === "cancelled") cancellation = "CANCELLED";
    else if (order.status === "pending") {
      await cancelWithNote(client, id, "Partner iptal etti.");
      cancellation = "CANCELLED";
    } else if (order.status === "confirmed") {
      if (order.cancel_request_rejected_at) {
        throw new PartnerOrderError("CANCELLATION_REJECTED", "The cancellation request was rejected; the order will be shipped.", 409);
      }
      await client.query("UPDATE commerce_orders SET cancel_requested_at=COALESCE(cancel_requested_at,now()) WHERE id=$1", [id]);
      cancellation = "REQUESTED";
    } else if (order.status === "shipped" || order.status === "delivered") {
      throw new PartnerOrderError("ORDER_ALREADY_SHIPPED", "The order has been shipped; arrange a return with operations.", 409);
    } else {
      throw new Error(`Partner order ${id} has unexpected status ${order.status}`);
    }
    const found = await readOrder(partner, "id", id, client);
    if (!found) throw new Error(`Partner order ${id} is missing in its own transaction`);
    await client.query("COMMIT");
    return { order: found.dto, cancellation };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
