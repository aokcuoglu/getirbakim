import "server-only";
import type { PoolClient } from "pg";
import type { OrderEmailKind } from "./order-email-state";

// Kept free of mail and payments so order-cancel.ts and the shipping steps can queue without import cycles (#1036).

/**
 * Queues an order email in the caller's transaction, next to the state change it reports. Partner orders (#426) get
 * none: the partner informs its own customer. A second call for the same order and kind does nothing.
 */
export async function queueOrderEmail(client: Pick<PoolClient, "query">, orderId: string, kind: OrderEmailKind) {
  await client.query(`INSERT INTO commerce_order_emails(order_id,kind) SELECT o.id,$2 FROM commerce_orders o
    WHERE o.id=$1 AND o.owner_kind<>'partner' ON CONFLICT DO NOTHING`, [orderId, kind]);
}
