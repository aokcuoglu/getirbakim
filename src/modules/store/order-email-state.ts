import type { StatusTone } from "@/modules/suppliers/run-status";

// Order email state shared by delivery (order-email.ts) and /yonetim/siparisler (#1035); no database access here.

export const orderEmailKinds = ["confirmation"] as const;
export type OrderEmailKind = (typeof orderEmailKinds)[number];
export type OrderEmailStatus = "pending" | "sent" | "skipped" | "failed";
/** A claim older than this is not in flight any more (a send takes seconds; the SMTP timeouts are 10–15 s). */
export const ORDER_EMAIL_LEASE_MINUTES = 10;

/** One commerce_order_emails row as the admin order list reads it; `in_flight` = claimed within the lease. */
export type AdminOrderEmail = {
  kind: OrderEmailKind; status: OrderEmailStatus; attempts: number; last_error: string | null; sent_at: string | null;
  created_at: string; claimed_at: string | null; requeued_at: string | null; in_flight: boolean;
};

export const orderEmailKindLabel: Record<OrderEmailKind, string> = { confirmation: "Sipariş onay e-postası" };
export const orderEmailStatusLook: Record<OrderEmailStatus, { tone: StatusTone; label: string }> = {
  sent: { tone: "success", label: "Gönderildi" },
  pending: { tone: "info", label: "Sırada" },
  skipped: { tone: "warning", label: "Gönderilmedi" },
  failed: { tone: "error", label: "Gönderilemedi" },
};

/** last_error in the admin's words; a provider's own message is shown as it came, after "Son hata:". */
export function orderEmailErrorLabel(lastError: string): string {
  if (lastError === "stale") return "Bir gün içinde gönderilemedi";
  if (lastError === "order no longer pending") return "Sipariş artık teyit beklemiyor (onaylandı, iptal ya da iade edildi)";
  if (/^(MAIL_|SMTP_|unknown MAIL_TRANSPORT)/.test(lastError)) return "E-posta gönderimi ayarlı değil";
  const stale = /^stale after (\d+) attempts: ([\s\S]*)$/.exec(lastError);
  if (stale) return `${stale[1]} denemeden sonra bırakıldı: ${stale[2]}`;
  return `Son hata: ${lastError}`;
}

type OrderState = { status: string; payment_status: string };
/** Whether the order still wants this email; delivery checks it before every send. */
export const orderEmailDue: Record<OrderEmailKind, (order: OrderState) => boolean> = {
  // Only an order still waiting for confirmation after a settled payment is confirmed; a cancel or refund in between skips it.
  confirmation: order => order.status === "pending" && order.payment_status === "paid",
};

/** An admin may put the email back in the queue unless a send is under way or the order no longer wants it. */
export function canResendOrderEmail(email: { kind: OrderEmailKind; in_flight: boolean }, order: OrderState) {
  return !email.in_flight && orderEmailDue[email.kind](order);
}
