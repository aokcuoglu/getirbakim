import "server-only";
// Kept free of the session and next/* so the outbox can be driven from tests and after() alike (like purchase-event.ts).
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { sendMail, type MailMessage, type MailResult } from "@/lib/mail";
import { contactEmail, contactPhone, siteName, siteUrl } from "@/lib/site";
import { money } from "./money";
import type { CommerceOrder } from "./orders";
import { invoiceAddressText, invoiceSummary, invoiceTypes } from "./tr-address";
import { ORDER_EMAIL_LEASE_MINUTES, orderEmailDue, type OrderEmailKind } from "./order-email-state";
import { orderLinkPath, orderLinkToken } from "./order-link";

/**
 * Order confirmation email (#951). recordPaid queues one row per order in the payment transaction that settles it;
 * deliverOrderEmails claims pending rows with a lease and sends them after the response (after()) or from the 5-minute
 * payment sweep. A row is sent at most once per claim. A failed send stays pending and is retried with a growing
 * backoff (RETRY_SQL) until the row is a day old; then it is given up as failed, so a provider outage of hours still
 * delivers. An admin's resend (requeueOrderEmail, #1035) puts any row that is not in flight back in the queue with a
 * fresh day and backoff; delivery still checks the order state before sending.
 */
const LEASE_MINUTES = ORDER_EMAIL_LEASE_MINUTES;
const STALE_HOURS = 24;
// Minutes after the last claim before the next try: 10, 30, 90, 270, then every 8 hours (about 7 tries in a day).
const RETRY_SQL = "LEAST(10*power(3,GREATEST(attempts-1,0)),480)::int";
// Recorded when the order no longer wants the email (orderEmailDue), e.g. a cancel or refund before the send.
const NO_LONGER_PENDING = "order no longer pending";

export type ConfirmationOrder = Pick<CommerceOrder,
  "id" | "number" | "customer_name" | "phone" | "address" | "note" | "created_at" | "subtotal_kurus" | "shipping_kurus" | "total_kurus"
  | "discount_percent" | "installment_count" | "installment_fee_kurus" | "invoice_type" | "invoice_company" | "invoice_tax_no" | "invoice_tax_office"
  | "invoice_province" | "invoice_district" | "invoice_address_line" | "invoice_postal_code">;
export type ConfirmationItem = { name: string; code: string; quantity: number; unit_price_kurus: string };
/** guestLink: a signed link (#1034) for a guest order, so the email opens it on any device; null keeps the plain links. */
export type ConfirmationData = {
  order: ConfirmationOrder; items: ConfirmationItem[]; hasAgreement: boolean; baseUrl: string;
  guestLink?: { token: string; expiresAt: Date } | null;
};

const colors = { text: "#222831", muted: "#626b75", link: "#0077c7", divider: "#e5e7eb" };

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const html = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>");
const time = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long", timeStyle: "short" });
const linkDate = (value: Date) => value.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long" });
/** +902163870078 → +90 216 387 00 78 */
const phoneLabel = (phone: string) => phone.replace(/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/, "+90 $1 $2 $3 $4");

/** Subject, plain text and HTML of the confirmation; every customer-sourced value is escaped in the HTML. */
export function buildOrderConfirmation({ order, items, hasAgreement, baseUrl, guestLink }: ConfirmationData): Omit<MailMessage, "to" | "messageId"> {
  const base = baseUrl.replace(/\/$/, "");
  const orderUrl = `${base}/siparis/${order.id}`;
  const links = [
    { label: "Siparişini görüntüle", url: guestLink ? base + orderLinkPath(order.id, guestLink.token) : orderUrl },
    ...(hasAgreement ? [{ label: "Sözleşme kopyan", url: guestLink ? base + orderLinkPath(order.id, guestLink.token, "sozlesme") : `${orderUrl}/sozlesme` }] : []),
    { label: "Mesafeli satış sözleşmesi", url: `${base}/mesafeli-satis-sozlesmesi` },
    { label: "Ön bilgilendirme formu", url: `${base}/on-bilgilendirme-formu` },
  ];
  const shipping = Number(order.shipping_kurus), fee = Number(order.installment_fee_kurus);
  const totals: { label: string; value: string }[] = [
    { label: "Ürün toplamı", value: money(Number(order.subtotal_kurus)) },
    ...(order.discount_percent > 0 ? [{ label: "Servis indirimi", value: `%${order.discount_percent} uygulandı` }] : []),
    { label: "Kargo", value: shipping ? money(shipping) : "Ücretsiz" },
    ...(fee > 0 && order.installment_count > 1 ? [{ label: `Vade farkı (${order.installment_count} taksit)`, value: money(fee) }] : []),
  ];
  const total = money(Number(order.total_kurus));
  const invoiceAddress = invoiceAddressText(order) ?? order.address;
  const invoice = invoiceSummary(order);
  const lines = items.map(item => ({
    name: item.name, detail: `${item.code} · ${item.quantity} adet × ${money(Number(item.unit_price_kurus))}`,
    total: money(Number(item.unit_price_kurus) * item.quantity),
  }));
  const subject = `Siparişini aldık — #${order.number}`;
  const intro = "Siparişini aldık, teşekkür ederiz. Ödemen alındı; siparişin teyit bekliyor. Stok ve fiyat teyidinden sonra siparişini hazırlayıp kargoya vereceğiz. Teyit edilemezse ödemenin tamamı iade edilir.";
  const pageNote = guestLink
    ? `Bu bağlantılar ${linkDate(guestLink.expiresAt)} tarihine kadar her cihazda açılır. Siparişinin bilgilerini içerdiği için bu bağlantıları kimseyle paylaşma.`
    : "Sipariş sayfası, siparişi verdiğin hesapla ya da siparişi verdiğin tarayıcıdan açılır.";
  const contact = `Sorun olursa bize ${contactEmail} adresinden ya da ${phoneLabel(contactPhone)} numarasından ulaşabilirsin.`;

  const text = [
    `Merhaba ${order.customer_name},`, "", intro, "",
    `Sipariş no: #${order.number}`, `Sipariş tarihi: ${time(order.created_at)}`, "",
    "Ürünler", ...lines.flatMap(line => [`- ${line.name}`, `  ${line.detail} = ${line.total}`]), "",
    ...totals.map(row => `${row.label}: ${row.value}`), `Toplam (KDV dahil): ${total}`, "",
    "Teslimat adresi", order.customer_name, order.phone, order.address, "",
    "Fatura adresi", invoiceAddress,
    ...(invoice ? [`Fatura: ${invoiceTypes.corporate} · ${invoice}`] : []),
    ...(order.note ? ["", `Not: ${order.note}`] : []), "",
    ...links.map(link => `${link.label}: ${link.url}`), pageNote, "",
    contact, "", siteName,
  ].join("\n");

  const p = (content: string, style = "") => `<p style="margin:0 0 12px;${style}">${content}</p>`;
  const heading = (content: string) => `<h2 style="margin:24px 0 8px;font-size:16px;line-height:24px;font-weight:600;color:${colors.text};">${content}</h2>`;
  const row = (label: string, value: string, strong = false) => `<tr><td style="padding:4px 0;${strong ? "font-weight:600;font-size:16px;" : ""}">${label}</td><td align="right" style="padding:4px 0;white-space:nowrap;${strong ? "font-weight:600;font-size:16px;" : ""}">${value}</td></tr>`;
  const link = (label: string, url: string) => `<a href="${escapeHtml(url)}" style="color:${colors.link};text-decoration:underline;">${label}</a>`;
  const itemRows = lines.map(line => `<tr><td style="padding:12px 0;border-bottom:1px solid ${colors.divider};vertical-align:top;"><strong style="font-weight:600;">${html(line.name)}</strong><br><span style="color:${colors.muted};font-size:13px;">${html(line.detail)}</span></td><td align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid ${colors.divider};vertical-align:top;white-space:nowrap;font-weight:600;">${html(line.total)}</td></tr>`).join("");
  const body = [
    `<p style="margin:0 0 4px;font-size:12px;letter-spacing:1px;color:${colors.muted};">SİPARİŞ #${html(order.number)}</p>`,
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:600;color:${colors.text};">Siparişini aldık</h1>`,
    p(`Merhaba ${html(order.customer_name)},`),
    p(html(intro)),
    p(`Sipariş tarihi: ${html(time(order.created_at))}`, `color:${colors.muted};font-size:13px;`),
    heading("Ürünler"),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${itemRows}</table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px;">${totals.map(item => row(html(item.label), html(item.value))).join("")}${row(`Toplam <span style="font-weight:400;font-size:13px;color:${colors.muted};">(KDV dahil)</span>`, html(total), true)}</table>`,
    heading("Teslimat adresi"),
    p(`${html(order.customer_name)}<br>${html(order.phone)}<br>${html(order.address)}`),
    heading("Fatura adresi"),
    p(html(invoiceAddress)),
    ...(invoice ? [p(`Fatura: ${html(invoiceTypes.corporate)} · ${html(invoice)}`)] : []),
    ...(order.note ? [p(`Not: ${html(order.note)}`)] : []),
    `<div style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${colors.divider};">`,
    ...links.map(item => p(link(html(item.label), item.url))),
    p(html(pageNote), `color:${colors.muted};font-size:13px;`),
    p(`Sorun olursa bize ${link(html(contactEmail), `mailto:${contactEmail}`)} adresinden ya da ${link(html(phoneLabel(contactPhone)), `tel:${contactPhone}`)} numarasından ulaşabilirsin.`, `color:${colors.muted};font-size:13px;`),
    "</div>",
  ].join("\n");
  const document = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:600px;"><tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:${colors.text};">
<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:${colors.text};">${html(siteName)}</p>
${body}
</td></tr></table>
</td></tr></table>
</body></html>`;
  return { subject, text, html: document };
}

/** Queues the confirmation in the caller's transaction; a second call for the same order does nothing. */
export async function queueOrderConfirmation(client: Pick<PoolClient, "query">, orderId: string) {
  await client.query("INSERT INTO commerce_order_emails(order_id,kind) VALUES($1,'confirmation') ON CONFLICT DO NOTHING", [orderId]);
}

type Send = (message: MailMessage) => Promise<MailResult>;
export type DeliverOptions = { orderId?: string; limit?: number; send?: Send };
/** `failed` counts rows given up in this call: tried and still unsent after a day. */
export type DeliverResult = { sent: number; skipped: number; failed: number };

const confirmationColumns = "id,number,email,customer_name,phone,address,note,created_at,subtotal_kurus,shipping_kurus,total_kurus,discount_percent,installment_count,installment_fee_kurus,invoice_type,invoice_company,invoice_tax_no,invoice_tax_office,invoice_province,invoice_district,invoice_address_line,invoice_postal_code";

async function confirmationMessage(orderId: string, requeuedAt: Date | null) {
  const [order, items, agreement] = await Promise.all([
    db.query<ConfirmationOrder & { email: string; status: string; payment_status: string; owner_kind: string }>(`SELECT ${confirmationColumns},status,payment_status,owner_kind FROM commerce_orders WHERE id=$1`, [orderId]),
    db.query<ConfirmationItem>("SELECT name,code,quantity,unit_price_kurus FROM commerce_order_items WHERE order_id=$1 ORDER BY code,product_id", [orderId]),
    db.query("SELECT 1 FROM commerce_order_agreements WHERE order_id=$1", [orderId]),
  ]);
  const row = order.rows[0];
  if (!row) throw new Error("Order not found");
  if (!orderEmailDue.confirmation(row)) return { number: row.number, message: null };
  // Signed at send time, so an admin's resend (#1035) carries a fresh 90-day link. Account orders keep the sign-in rule.
  const guestLink = row.owner_kind === "guest" ? orderLinkToken(orderId) : null;
  const content = buildOrderConfirmation({ order: row, items: items.rows, hasAgreement: Boolean(agreement.rowCount), baseUrl: siteUrl, guestLink });
  // Deterministic, so a retry after a lost reply is recognisable as the same message; an admin's resend is a new one.
  const resend = requeuedAt ? `-r${Math.floor(new Date(requeuedAt).getTime() / 1000)}` : "";
  return { number: row.number, message: { ...content, to: row.email, messageId: `<order-${orderId}-confirmation${resend}@${new URL(siteUrl).hostname}>` } };
}

/**
 * Sends pending order emails: all of them (oldest first, up to `limit`) or only `orderId`'s. Rows older than a day are
 * given up (counted from an admin's resend, if any): `failed` when tried, `skipped`/stale when never tried. Each row is claimed atomically (SKIP LOCKED plus the
 * retry backoff, which is never shorter than the lease), so concurrent calls never send it twice.
 */
export async function deliverOrderEmails({ orderId, limit = 10, send = message => sendMail(message) }: DeliverOptions = {}): Promise<DeliverResult> {
  const only = orderId ?? null;
  const result: DeliverResult = { sent: 0, skipped: 0, failed: 0 };
  const given = (await db.query<{ status: string; number: string; attempts: number }>(
    `UPDATE commerce_order_emails e SET status=CASE WHEN e.attempts>0 THEN 'failed' ELSE 'skipped' END,
      last_error=CASE WHEN e.attempts>0 THEN left('stale after '||e.attempts||' attempts: '||coalesce(e.last_error,''),500) ELSE 'stale' END
     FROM commerce_orders o WHERE o.id=e.order_id AND e.status='pending'
      AND COALESCE(e.requeued_at,e.created_at) < now()-make_interval(hours=>$2) AND ($1::uuid IS NULL OR e.order_id=$1)
      AND (e.claimed_at IS NULL OR e.claimed_at < now()-make_interval(mins=>$3))
     RETURNING e.status,o.number::text,e.attempts`, [only, STALE_HOURS, LEASE_MINUTES],
  )).rows;
  for (const row of given) {
    if (row.status === "failed") { result.failed++; console.error("Order email given up", { order: row.number, attempts: row.attempts }); }
  }
  const claimed = (await db.query<{ order_id: string; kind: string; attempts: number; requeued_at: Date | null }>(
    `UPDATE commerce_order_emails SET claimed_at=now(),attempts=attempts+1 WHERE (order_id,kind) IN (
       SELECT order_id,kind FROM commerce_order_emails WHERE status='pending' AND ($1::uuid IS NULL OR order_id=$1)
        AND (claimed_at IS NULL OR claimed_at < now()-make_interval(mins=>${RETRY_SQL}))
       ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING order_id::text,kind,attempts,requeued_at`, [only, limit],
  )).rows;
  for (const row of claimed) {
    let number: string | null = null;
    try {
      const built = await confirmationMessage(row.order_id, row.requeued_at);
      number = built.number;
      if (!built.message) {
        await db.query("UPDATE commerce_order_emails SET status='skipped',last_error=$3 WHERE order_id=$1 AND kind=$2", [row.order_id, row.kind, NO_LONGER_PENDING]);
        result.skipped++;
        continue;
      }
      const outcome = await send(built.message);
      if (outcome.status === "sent") {
        await db.query("UPDATE commerce_order_emails SET status='sent',sent_at=now(),message_id=$3,last_error=NULL WHERE order_id=$1 AND kind=$2",
          [row.order_id, row.kind, outcome.messageId]);
        result.sent++;
      } else {
        await db.query("UPDATE commerce_order_emails SET status='skipped',last_error=$3 WHERE order_id=$1 AND kind=$2", [row.order_id, row.kind, outcome.reason.slice(0, 500)]);
        console.info("Order email skipped: mail transport not configured", { order: number, reason: outcome.reason });
        result.skipped++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Stays pending: the next claim waits for the backoff, and a day-old row is given up above.
      await db.query("UPDATE commerce_order_emails SET last_error=$3 WHERE order_id=$1 AND kind=$2", [row.order_id, row.kind, message.slice(0, 500)]);
      // Never the address or name: a provider's message may carry them, so only its code is logged.
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      console.error("Order email failed", { order: number ?? row.order_id, attempt: row.attempts, code });
    }
  }
  return result;
}

// orderEmailDue in SQL, per kind (o = commerce_orders): a resend is refused for an order that no longer wants the email.
const dueSql: Record<OrderEmailKind, string> = { confirmation: "o.status='pending' AND o.payment_status='paid'" };

/**
 * An admin's resend (#1035): puts the row back in the queue with no attempts, no backoff and a fresh day. Refused (null)
 * when there is no such row, the order no longer wants the email, a send holds it right now (a claim within the lease)
 * or it was sent within the last minute (a double click from two tabs). Returns the order number. Delivery still checks
 * the order state before sending.
 */
export async function requeueOrderEmail(orderId: string, kind: OrderEmailKind, adminId: string): Promise<string | null> {
  if (!Object.hasOwn(dueSql, kind)) return null;
  const result = await db.query<{ number: string }>(
    `UPDATE commerce_order_emails e SET status='pending',attempts=0,claimed_at=NULL,last_error=NULL,requeued_at=now(),requeued_by=$3
     FROM commerce_orders o WHERE o.id=e.order_id AND e.order_id=$1 AND e.kind=$2 AND (${dueSql[kind]})
      AND (e.status<>'pending' OR e.claimed_at IS NULL OR e.claimed_at < now()-make_interval(mins=>$4))
      AND (e.sent_at IS NULL OR e.sent_at < now()-interval '1 minute')
     RETURNING o.number::text`,
    [orderId, kind, adminId, LEASE_MINUTES],
  );
  return result.rows[0]?.number ?? null;
}

/** deliverOrderEmails for after(): logs instead of throwing, so a mail problem never reaches the payment flow. */
export async function deliverOrderEmailsSafely(options: DeliverOptions = {}) {
  try { return await deliverOrderEmails(options); }
  catch (error) {
    console.error("Order email delivery failed", { error: error instanceof Error ? error.message : error });
    return null;
  }
}
