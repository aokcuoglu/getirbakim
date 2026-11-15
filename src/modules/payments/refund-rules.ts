// Pure rules of TAMI reversals (#619), shared by the server action and the admin order list.

export type ReversalKind = "void" | "refund";
export type RefundStatus = "requested" | "succeeded" | "failed" | "unknown";
/** A row in requested/unknown/succeeded blocks a new call for the same payment attempt (unique index in db/commerce.sql). */
export const activeRefundStatuses: readonly RefundStatus[] = ["requested", "unknown", "succeeded"];

const istanbulDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * TAMI cancels (void) only on the day of the payment, before end-of-day settlement; afterwards it must be refunded.
 * One call per admin action: a same-day payment is voided; once TAMI has rejected a void for it, the next action
 * sends a refund. There is no silent void→refund chain, so a refund never follows a void without a deliberate click.
 */
export function reversalKind(paidAt: Date | string | null, earlier: { kind: string; status: string }[] = [], now = new Date()): ReversalKind {
  if (!paidAt || earlier.some(r => r.kind === "void" && r.status === "failed")) return "refund";
  return istanbulDay.format(new Date(paidAt)) === istanbulDay.format(now) ? "void" : "refund";
}

/**
 * TAMI's transactionDate is Istanbul wall time without an offset ("2026-11-15T10:04:19.595942"). Turkey stays on
 * UTC+3 all year (no DST since 2016). Null when the value is not in that shape.
 */
export function istanbulLocalTime(value: unknown): Date | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(value) : null;
  if (!match) return null;
  const [, y, mo, d, h, mi, sec, fraction = "0"] = match;
  const ms = Number(fraction.padEnd(3, "0").slice(0, 3));
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 3, Number(mi), Number(sec), ms));
}

type PaymentRow = { id: string; status: string; paid_at?: Date | string | null };
type RefundRow = { payment_id: string; status: string };

/**
 * Payment attempts operations may reverse through TAMI. A cancelled paid order (refund_required) gets back every
 * captured attempt; a paid order only its extra captures, so at least one captured attempt always stays.
 */
export function refundablePayments<P extends PaymentRow>(order: { payment_status: string; refunded_at?: Date | string | null }, payments: P[], refunds: RefundRow[]): P[] {
  const blocked = new Set(refunds.filter(r => (activeRefundStatuses as readonly string[]).includes(r.status)).map(r => r.payment_id));
  // Attempts captured before an earlier refund of the order (e.g. recorded by hand) were part of that refund.
  const refundedAt = order.refunded_at ? new Date(order.refunded_at).getTime() : null;
  const coveredByEarlierRefund = (p: P) => refundedAt !== null && p.paid_at != null && new Date(p.paid_at).getTime() <= refundedAt;
  const open = payments.filter(p => p.status === "succeeded" && !blocked.has(p.id) && !coveredByEarlierRefund(p));
  if (order.payment_status === "refund_required") return open;
  // Attempts with a call in flight may already be reversed, so they do not count as the one that stays.
  if (order.payment_status === "paid") return open.length >= 2 ? open : [];
  return [];
}

export const refundKindLabel: Record<ReversalKind, string> = { void: "İptal", refund: "İade" };
export const refundStatusLabel: Record<RefundStatus, string> = {
  requested: "Yanıt bekleniyor", succeeded: "Başarılı", failed: "Reddedildi", unknown: "İade sonucu bilinmiyor",
};
