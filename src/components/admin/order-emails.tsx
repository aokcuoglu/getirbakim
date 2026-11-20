import { Send } from "lucide-react";
import { resendOrderEmail } from "@/modules/admin/commerce-actions";
import { formatDateTime } from "@/modules/admin/format";
import {
  canResendOrderEmail, orderEmailErrorLabel, orderEmailKindLabel, orderEmailStatusLook, type AdminOrderEmail,
} from "@/modules/store/order-email-state";
import { StatusBadge } from "@/components/admin/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";

type EmailOrder = { id: string; number: string; owner_kind: string; status: string; payment_status: string; paid_at: Date | null };

const time = (value: string) => formatDateTime(value, { year: true });

/** Why an email cannot be resent from here; null when it can. A missing mail setup is a warning, the rest is neutral. */
function blockedReason(email: AdminOrderEmail, order: EmailOrder, mailReady: boolean) {
  if (!mailReady) return { text: "E-posta gönderimi ayarlı değil; yeniden gönderilemez.", className: "text-warning" };
  if (email.in_flight) return { text: "Gönderim sürüyor.", className: "text-muted-foreground" };
  if (!canResendOrderEmail(email, order)) return { text: "Sipariş artık teyit beklemiyor; bu e-posta yeniden gönderilmez.", className: "text-muted-foreground" };
  return null;
}

/**
 * The order's emails (#1035) in the "Teslimat ve ödeme" details: state, attempts, the last error in plain words and a
 * resend while the order still wants the email. Partner and unpaid orders get no confirmation, so nothing is shown.
 */
export function OrderEmails({ order, emails, back, mailReady }: { order: EmailOrder; emails: AdminOrderEmail[]; back: string; mailReady: boolean }) {
  if (!emails.length && (order.owner_kind === "partner" || order.paid_at === null)) return null;
  return <div className="sm:col-span-2"><dt className="text-muted-foreground">E-posta</dt>
    {emails.length ? <dd className="flex flex-col gap-2">{emails.map(email => {
      const label = orderEmailKindLabel[email.kind];
      const look = orderEmailStatusLook[email.status];
      const reason = blockedReason(email, order, mailReady);
      return <div key={email.kind} className="flex flex-col items-start gap-1">
        <span className="flex flex-wrap items-center gap-2"><span>{label}</span><StatusBadge tone={look.tone}>{look.label}</StatusBadge></span>
        <span className="text-muted-foreground tabular-nums">{[
          `${email.attempts} deneme`,
          email.status === "sent" && email.sent_at ? `Gönderildi ${time(email.sent_at)}` : null,
          email.requeued_at ? `Yeniden kuyruğa alındı ${time(email.requeued_at)}` : `Kuyruğa alındı ${time(email.created_at)}`,
        ].filter(Boolean).join(" · ")}</span>
        {email.last_error && <span className={`break-all ${email.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{orderEmailErrorLabel(email.last_error)}</span>}
        {reason ? <span className={reason.className}>{reason.text}</span> : <form action={resendOrderEmail}>
          <input type="hidden" name="id" value={order.id}/>
          <input type="hidden" name="kind" value={email.kind}/>
          <input type="hidden" name="back" value={back}/>
          <SubmitButton variant="outline" size="sm" pendingLabel="Gönderiliyor…" icon={<Send data-icon="inline-start" aria-hidden="true"/>}>Yeniden gönder</SubmitButton>
        </form>}
      </div>;
    })}</dd> : <dd className="text-muted-foreground">Bu sipariş için e-posta kaydı yok.</dd>}
  </div>;
}
