"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentOrder, currentOrderOwners } from "@/modules/store/order-read";
import { reconcileOrderPayments } from "@/modules/payments/checkout";
import { cancelOrderByCustomer, type CustomerCancelResult } from "@/modules/store/customer-cancel";

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

const cancelInput = z.object({ orderId: z.uuid(), expected: z.enum(["awaiting_payment", "pending"]) });
// The order page's ?iptal= codes; "missing" goes back to the order list instead.
const cancelOutcome: Record<Exclude<CustomerCancelResult, "missing">, string> = {
  cancelled: "tamam", refund: "tamam", already: "tamam", paid: "odendi", unverified: "dogrulanamadi", closed: "kapali",
};

/** Customer cancel (#607). Ownership comes from the session (account or this browser's guest cart), never the form. */
export async function cancelOrder(form: FormData) {
  const input = cancelInput.safeParse({ orderId: form.get("orderId"), expected: form.get("expected") });
  if (!input.success) redirect("/siparisler");
  const { orderId, expected } = input.data;
  let result: CustomerCancelResult | "error";
  try { result = await cancelOrderByCustomer(orderId, await currentOrderOwners(), expected); }
  catch (error) {
    console.error("Customer order cancel failed", { orderId, error: error instanceof Error ? error.message : error });
    result = "error";
  }
  if (result === "missing") redirect("/siparisler");
  revalidatePath(`/siparis/${orderId}`);
  revalidatePath("/siparisler");
  revalidatePath("/yonetim", "layout");
  redirect(`/siparis/${orderId}?iptal=${result === "error" ? "hata" : cancelOutcome[result]}`);
}
