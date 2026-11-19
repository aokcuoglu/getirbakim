"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { CONSENT_COOKIE } from "@/lib/cookie-consent";
import { currentAccount } from "@/modules/auth/session";
import { analyticsConfig } from "@/modules/analytics/config";
import { purchaseClaimAllowed } from "@/modules/analytics/purchase";
import type { PurchaseEvent, RefundEvent } from "@/modules/analytics/events";
import { claimPurchase } from "@/modules/store/purchase-event";
import { claimRefund } from "@/modules/store/refund-event";
import { currentOrder, currentOrderOwners } from "@/modules/store/order-read";
import { INTERACTIVE_RECONCILE_MS, reconcileOrderPayments } from "@/modules/payments/checkout";
import { cancelOrderByCustomer, type CustomerCancelResult } from "@/modules/store/customer-cancel";
import { deliverOrderEmailsSafely } from "@/modules/store/order-email";

/** Polled by the order page while the customer pays in TAMI's tab. */
export async function paymentState(orderId: string) {
  if (!z.uuid().safeParse(orderId).success) return null;
  const result = await currentOrder(orderId);
  if (!result) return null;
  const awaiting = result.order.payment_status === "awaiting";
  if (awaiting) {
    // Budgeted: actions run one at a time on the client, so a slow TAMI would also hold back a cancel (#711).
    try { await reconcileOrderPayments(orderId, { minIntervalSeconds: 4, deadlineMs: INTERACTIVE_RECONCILE_MS }); }
    catch (error) { console.error("Payment polling failed", { orderId, error: error instanceof Error ? error.message : error }); }
  }
  const order = (await currentOrder(orderId))?.order;
  // A payment settled by this poll queued the confirmation email (#951); it is sent after the reply. Polls that
  // changed nothing leave the outbox alone.
  if (awaiting && order && order.payment_status !== "awaiting") after(() => deliverOrderEmailsSafely({ orderId }));
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

/**
 * The order's purchase event, at most once (#675). Refused before the once-only flag is touched when the visitor is an admin
 * or no consented channel would measure it (GA4 with analytics consent, an advertising purchase tag with marketing consent,
 * #676); ownership comes from the session.
 */
export async function claimPurchaseEvent(orderId: string): Promise<PurchaseEvent | null> {
  if (!z.uuid().safeParse(orderId).success) return null;
  try {
    const [account, cookieStore] = await Promise.all([currentAccount(), cookies()]);
    const { ga4, ads, metaPixel } = analyticsConfig();
    const allowed = purchaseClaimAllowed({
      ga4, marketing: Boolean(ads?.purchaseLabel || metaPixel), role: account?.role,
      consent: cookieStore.get(CONSENT_COOKIE)?.value ?? null, now: Date.now(),
    });
    if (!allowed) return null;
    return await claimPurchase(orderId, await currentOrderOwners());
  } catch (error) {
    console.error("Purchase event claim failed", { orderId, error: error instanceof Error ? error.message : error });
    return null;
  }
}

/**
 * The cancelled paid order's GA4 refund event, at most once and only after its purchase was measured (#750). Refused on the
 * same terms as the purchase: no GA4 id, an admin visitor or no analytics consent; ownership comes from the session.
 */
export async function claimRefundEvent(orderId: string): Promise<RefundEvent | null> {
  if (!z.uuid().safeParse(orderId).success) return null;
  try {
    const [account, cookieStore] = await Promise.all([currentAccount(), cookies()]);
    // Refunds are GA4-only: the advertising tags have no refund event.
    const allowed = purchaseClaimAllowed({
      ga4: analyticsConfig().ga4, marketing: false, role: account?.role,
      consent: cookieStore.get(CONSENT_COOKIE)?.value ?? null, now: Date.now(),
    });
    if (!allowed) return null;
    return await claimRefund(orderId, await currentOrderOwners());
  } catch (error) {
    console.error("Refund event claim failed", { orderId, error: error instanceof Error ? error.message : error });
    return null;
  }
}
