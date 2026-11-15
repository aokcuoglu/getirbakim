// Pure rules of TAMI reversals (#619), shared by the server action and the admin order list.

export type ReversalKind = "void" | "refund";
export type RefundStatus = "requested" | "succeeded" | "failed" | "unknown";
/** A row in requested/unknown/succeeded blocks a new call for the same payment attempt (unique index in db/commerce.sql). */
export const activeRefundStatuses: readonly RefundStatus[] = ["requested", "unknown", "succeeded"];

const istanbulDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * TAMI cancels (void) only on the day of the payment, before end-of-day settlement; afterwards it must be refunded.
 * A same-day payment tries void first and falls back to refund when TAMI rejects the void.
 */
export function reversalKinds(paidAt: Date | string | null, now = new Date()): ReversalKind[] {
  if (!paidAt) return ["refund"];
  return istanbulDay.format(new Date(paidAt)) === istanbulDay.format(now) ? ["void", "refund"] : ["refund"];
}

type PaymentRow = { id: string; status: string };
type RefundRow = { payment_id: string; status: string };

/**
 * Payment attempts operations may reverse through TAMI. A cancelled paid order (refund_required) gets back every
 * captured attempt; a paid order only its extra captures, so at least one captured attempt always stays.
 */
export function refundablePayments<P extends PaymentRow>(order: { payment_status: string }, payments: P[], refunds: RefundRow[]): P[] {
  const blocked = new Set(refunds.filter(r => (activeRefundStatuses as readonly string[]).includes(r.status)).map(r => r.payment_id));
  const open = payments.filter(p => p.status === "succeeded" && !blocked.has(p.id));
  if (order.payment_status === "refund_required") return open;
  // Attempts with a call in flight may already be reversed, so they do not count as the one that stays.
  if (order.payment_status === "paid") return open.length >= 2 ? open : [];
  return [];
}

export const refundKindLabel: Record<ReversalKind, string> = { void: "İptal", refund: "İade" };
export const refundStatusLabel: Record<RefundStatus, string> = {
  requested: "Yanıt bekleniyor", succeeded: "Başarılı", failed: "Reddedildi", unknown: "Sonuç bilinmiyor",
};
