"use server";
import { z } from "zod";
import { currentOrder } from "@/modules/store/order-read";
import { reconcileOrderPayments } from "@/modules/payments/checkout";

/** Polled by the order page while the customer pays in TAMI's tab. */
export async function paymentState(orderId: string) {
  if (!z.uuid().safeParse(orderId).success) return null;
  const result = await currentOrder(orderId);
  if (!result) return null;
  if (result.order.payment_status === "awaiting") {
    try { await reconcileOrderPayments(orderId, { minIntervalSeconds: 4 }); }
    catch (error) { console.error("Payment polling failed", { orderId, error: error instanceof Error ? error.message : error }); }
  }
  const order = (await currentOrder(orderId))?.order;
  return order ? `${order.status}:${order.payment_status}` : null;
}
