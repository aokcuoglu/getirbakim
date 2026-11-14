import "server-only";
import type { PoolClient } from "pg";

/**
 * Returns the store stock an order's lines hold (commerce_order_items.reserved_quantity) and clears it, so running
 * it twice never restores twice. Call inside a transaction that holds the order row lock.
 * Lines without a recorded value (NULL, written before the column existed) follow the old rule: their full quantity.
 * Supplier offers are never reserved; their ids are not in store_products.
 */
export async function releaseReservedStock(client: PoolClient, orderId: string) {
  // Same lock order as checkout (store_products by id), so a cancel never deadlocks with a purchase.
  await client.query(`SELECT p.id FROM store_products p JOIN commerce_order_items i ON i.product_id=p.id
    WHERE i.order_id=$1 AND COALESCE(i.reserved_quantity,i.quantity)>0 ORDER BY p.id FOR UPDATE OF p`, [orderId]);
  await client.query(`UPDATE store_products p SET stock=p.stock+COALESCE(i.reserved_quantity,i.quantity),updated_at=now()
    FROM commerce_order_items i WHERE i.order_id=$1 AND i.product_id=p.id AND COALESCE(i.reserved_quantity,i.quantity)>0`, [orderId]);
  await client.query("UPDATE commerce_order_items SET reserved_quantity=0 WHERE order_id=$1 AND reserved_quantity IS DISTINCT FROM 0", [orderId]);
}
