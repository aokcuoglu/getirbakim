import "server-only";
// Kept free of the session and next/* so the outbox can be driven from tests and after() alike (like purchase-event.ts).
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { sendMail, type MailMessage, type MailResult } from "@/lib/mail";
import { siteName, siteUrl } from "@/lib/site";
import { money } from "./money";
import type { CommerceOrder } from "./orders";
import { invoiceAddressText, invoiceSummary, invoiceTypes } from "./tr-address";
import { ORDER_EMAIL_LEASE_MINUTES, orderEmailDue, type OrderEmailKind } from "./order-email-state";
import { queueOrderEmail } from "./order-email-queue";
import { orderLinkPath, orderLinkToken } from "./order-link";
import { carrierLabel } from "./shipment";
import {
  colors, contactHtml, contactText, emailDocument, footerStart, heading, html, link, linkDate, orderLabel, p, time, title,
} from "./order-email-layout";

/**
 * Order emails: the confirmation (#951) and the shipped, cancelled and refunded status emails (#1036). Each is queued
 * as one row per order and kind in the transaction that changes the order (recordPaid, shipping, cancel, refund);
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
// Recorded when the order no longer wants the email (orderEmailDue), e.g. a cancel or refund before the send. The text
// predates the status emails; existing rows carry it, so it stays.
const NO_LONGER_PENDING = "order no longer pending";

export type ConfirmationOrder = Pick<CommerceOrder,
  "id" | "number" | "customer_name" | "phone" | "address" | "note" | "created_at" | "subtotal_kurus" | "shipping_kurus" | "total_kurus"
  | "discount_percent" | "installment_count" | "installment_fee_kurus" | "invoice_type" | "invoice_company" | "invoice_tax_no" | "invoice_tax_office"
  | "invoice_province" | "invoice_district" | "invoice_address_line" | "invoice_postal_code">;
export type ConfirmationItem = { name: string; code: string; quantity: number; unit_price_kurus: string };
/** A signed link (#1034) for a guest order, so the email opens it on any device; null keeps the plain links. */
export type GuestLink = { token: string; expiresAt: Date } | null;
export type ConfirmationData = {
  order: ConfirmationOrder; items: ConfirmationItem[]; hasAgreement: boolean; baseUrl: string;
  guestLink?: GuestLink;
};
type EmailContent = Omit<MailMessage, "to" | "messageId">;
const accountPageNote = "Sipariş sayfası, siparişi verdiğin hesapla ya da siparişi verdiğin tarayıcıdan açılır.";

/** Subject, plain text and HTML of the confirmation; every customer-sourced value is escaped in the HTML. */
export function buildOrderConfirmation({ order, items, hasAgreement, baseUrl, guestLink }: ConfirmationData): EmailContent {
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
    : accountPageNote;

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
    contactText, "", siteName,
  ].join("\n");

  const row = (label: string, value: string, strong = false) => `<tr><td style="padding:4px 0;${strong ? "font-weight:600;font-size:16px;" : ""}">${label}</td><td align="right" style="padding:4px 0;white-space:nowrap;${strong ? "font-weight:600;font-size:16px;" : ""}">${value}</td></tr>`;
  const itemRows = lines.map(line => `<tr><td style="padding:12px 0;border-bottom:1px solid ${colors.divider};vertical-align:top;"><strong style="font-weight:600;">${html(line.name)}</strong><br><span style="color:${colors.muted};font-size:13px;">${html(line.detail)}</span></td><td align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid ${colors.divider};vertical-align:top;white-space:nowrap;font-weight:600;">${html(line.total)}</td></tr>`).join("");
  const body = [
    orderLabel(order.number),
    title("Siparişini aldık"),
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
    footerStart,
    ...links.map(item => p(link(html(item.label), item.url))),
    p(html(pageNote), `color:${colors.muted};font-size:13px;`),
    contactHtml(),
    "</div>",
  ].join("\n");
  return { subject, text, html: emailDocument(subject, body) };
}

/** The order columns the status emails (#1036) read. */
export type StatusOrder = Pick<CommerceOrder, "id" | "number" | "customer_name" | "phone" | "address"> & {
  carrier: string | null; carrier_name: string | null; tracking_no: string | null; tracking_url: string | null;
  cancelled_by: string | null; payment_status: string;
};
export type StatusData = { order: StatusOrder; baseUrl: string; guestLink?: GuestLink };
/** refundKurus: the sum of the order's succeeded TAMI reversals; null or 0 when the refund was recorded by hand. */
export type RefundData = StatusData & { refundKurus?: number | null };

/** One paragraph; `html` (already escaped) replaces the escaped text in the HTML part, e.g. for a link. */
type Paragraph = { text: string; html?: string };
type StatusSection = { heading: string; lines: string[] };

/**
 * The common shape of a status email: greeting, the order number, the body, an optional section (the delivery address),
 * the order link (signed for a guest order, with how long it opens) and the contact line. Everything is escaped.
 */
function statusEmail({ order, baseUrl, guestLink }: StatusData, subject: string, heading1: string, paragraphs: Paragraph[], section?: StatusSection): EmailContent {
  const base = baseUrl.replace(/\/$/, "");
  const orderUrl = guestLink ? base + orderLinkPath(order.id, guestLink.token) : `${base}/siparis/${order.id}`;
  const pageNote = guestLink
    ? `Bu bağlantı ${linkDate(guestLink.expiresAt)} tarihine kadar her cihazda açılır. Siparişinin bilgilerini içerdiği için bu bağlantıyı kimseyle paylaşma.`
    : accountPageNote;
  const text = [
    `Merhaba ${order.customer_name},`, "", ...paragraphs.map(item => item.text), "",
    `Sipariş no: #${order.number}`, "",
    ...(section ? [section.heading, ...section.lines, ""] : []),
    `Siparişini görüntüle: ${orderUrl}`, pageNote, "",
    contactText, "", siteName,
  ].join("\n");
  const body = [
    orderLabel(order.number),
    title(heading1),
    p(`Merhaba ${html(order.customer_name)},`),
    ...paragraphs.map(item => p(item.html ?? html(item.text))),
    ...(section ? [heading(html(section.heading)), p(section.lines.map(html).join("<br>"))] : []),
    footerStart,
    p(link("Siparişini görüntüle", orderUrl)),
    p(html(pageNote), `color:${colors.muted};font-size:13px;`),
    contactHtml(),
    "</div>",
  ].join("\n");
  return { subject, text, html: emailDocument(subject, body) };
}

/** The order was handed to the carrier: carrier, tracking number and link when known, and the delivery address. */
export function buildOrderShipped(data: StatusData): EmailContent {
  const { order } = data;
  const carrier = carrierLabel(order.carrier, order.carrier_name);
  const paragraphs: Paragraph[] = [{ text: carrier ? `Siparişini ${carrier} ile kargoya verdik.` : "Siparişini kargoya verdik." }];
  if (order.tracking_no) paragraphs.push({ text: `Takip numarası: ${order.tracking_no}` });
  if (order.tracking_url) {
    paragraphs.push({ text: `Kargonu takip et: ${order.tracking_url}`, html: link("Kargonu takip et", order.tracking_url) });
  } else if (order.tracking_no) {
    paragraphs.push({ text: "Takip numaranla kargo firmasının sitesinden sorgulayabilirsin." });
  } else {
    // A Geliver label's tracking number may arrive later by webhook; the order page shows it then.
    paragraphs.push({ text: "Takip numarası belli olduğunda sipariş sayfanda görünecek." });
  }
  return statusEmail(data, `Siparişin kargoya verildi — #${order.number}`, "Siparişin yola çıktı", paragraphs,
    { heading: "Teslimat adresi", lines: [order.customer_name, order.phone, order.address] });
}

/** The order was cancelled; a paid one says that the whole payment comes back and that a refund email follows. */
export function buildOrderCancelled(data: StatusData): EmailContent {
  const { order } = data;
  const paragraphs: Paragraph[] = [{
    text: order.cancelled_by === "customer" ? "Talebin üzerine siparişini iptal ettik." : "Siparişini iptal etmek zorunda kaldık.",
  }];
  if (order.payment_status === "refund_required" || order.payment_status === "refunded") {
    paragraphs.push({ text: "Ödemenin tamamı iade edilecek; iade tamamlandığında sana ayrıca e-posta göndereceğiz." });
  }
  return statusEmail(data, `Siparişin iptal edildi — #${order.number}`, "Siparişin iptal edildi", paragraphs);
}

/** The payment was refunded; stands alone, without the cancel email. */
export function buildOrderRefunded(data: RefundData): EmailContent {
  const { order, refundKurus } = data;
  const paragraphs: Paragraph[] = [{ text: `#${order.number} numaralı siparişinin ödemesini iade ettik.` }];
  if (refundKurus && refundKurus > 0) paragraphs.push({ text: `İade tutarı: ${money(refundKurus)}` });
  paragraphs.push({ text: "İadenin kartına yansıması bankana bağlı olarak birkaç iş günü sürebilir." });
  return statusEmail(data, `Ödemen iade edildi — #${order.number}`, "Ödemen iade edildi", paragraphs);
}

/** Queues the confirmation in the caller's transaction; a second call for the same order does nothing. */
export async function queueOrderConfirmation(client: Pick<PoolClient, "query">, orderId: string) {
  await queueOrderEmail(client, orderId, "confirmation");
}

type Send = (message: MailMessage) => Promise<MailResult>;
export type DeliverOptions = { orderId?: string; limit?: number; send?: Send };
/** `failed` counts rows given up in this call: tried and still unsent after a day. */
export type DeliverResult = { sent: number; skipped: number; failed: number };

const orderColumns = "id,number,email,customer_name,phone,address,note,created_at,subtotal_kurus,shipping_kurus,total_kurus,discount_percent,installment_count,installment_fee_kurus,invoice_type,invoice_company,invoice_tax_no,invoice_tax_office,invoice_province,invoice_district,invoice_address_line,invoice_postal_code,carrier,carrier_name,tracking_no,tracking_url,cancelled_by,status,payment_status,owner_kind";
type MessageOrder = ConfirmationOrder & StatusOrder & { email: string; status: string; owner_kind: string };

/** Builds the email for `kind`, or null when the order no longer wants it (orderEmailDue). */
async function orderMessage(orderId: string, kind: OrderEmailKind, requeuedAt: Date | null) {
  const row = (await db.query<MessageOrder>(`SELECT ${orderColumns} FROM commerce_orders WHERE id=$1`, [orderId])).rows[0];
  if (!row) throw new Error("Order not found");
  if (!orderEmailDue[kind](row)) return { number: row.number, message: null };
  // Signed at send time, so an admin's resend (#1035) carries a fresh 90-day link. Account orders keep the sign-in rule.
  const guestLink = row.owner_kind === "guest" ? orderLinkToken(orderId) : null;
  const status: StatusData = { order: row, baseUrl: siteUrl, guestLink };
  let content: EmailContent;
  if (kind === "confirmation") {
    const [items, agreement] = await Promise.all([
      db.query<ConfirmationItem>("SELECT name,code,quantity,unit_price_kurus FROM commerce_order_items WHERE order_id=$1 ORDER BY code,product_id", [orderId]),
      db.query("SELECT 1 FROM commerce_order_agreements WHERE order_id=$1", [orderId]),
    ]);
    content = buildOrderConfirmation({ order: row, items: items.rows, hasAgreement: Boolean(agreement.rowCount), baseUrl: siteUrl, guestLink });
  } else if (kind === "shipped") {
    content = buildOrderShipped(status);
  } else if (kind === "cancelled") {
    content = buildOrderCancelled(status);
  } else {
    const refund = (await db.query<{ total: string | null }>(
      "SELECT sum(amount_kurus)::text AS total FROM commerce_payment_refunds WHERE order_id=$1 AND status='succeeded'", [orderId])).rows[0];
    content = buildOrderRefunded({ ...status, refundKurus: refund?.total ? Number(refund.total) : null });
  }
  // Deterministic, so a retry after a lost reply is recognisable as the same message; an admin's resend is a new one.
  const resend = requeuedAt ? `-r${Math.floor(new Date(requeuedAt).getTime() / 1000)}` : "";
  return { number: row.number, message: { ...content, to: row.email, messageId: `<order-${orderId}-${kind}${resend}@${new URL(siteUrl).hostname}>` } };
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
  // Sent in queue order, so a cancel email goes out before the refund email that follows it (#1036).
  const claimed = (await db.query<{ order_id: string; kind: OrderEmailKind; attempts: number; requeued_at: Date | null }>(
    `WITH claimed AS (UPDATE commerce_order_emails SET claimed_at=now(),attempts=attempts+1 WHERE (order_id,kind) IN (
       SELECT order_id,kind FROM commerce_order_emails WHERE status='pending' AND ($1::uuid IS NULL OR order_id=$1)
        AND (claimed_at IS NULL OR claimed_at < now()-make_interval(mins=>${RETRY_SQL}))
       ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING order_id::text,kind,attempts,requeued_at,created_at)
     SELECT order_id,kind,attempts,requeued_at FROM claimed ORDER BY created_at,order_id,kind`, [only, limit],
  )).rows;
  for (const row of claimed) {
    let number: string | null = null;
    try {
      const built = await orderMessage(row.order_id, row.kind, row.requeued_at);
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
const dueSql: Record<OrderEmailKind, string> = {
  confirmation: "o.status='pending' AND o.payment_status='paid'",
  shipped: "o.status='shipped'",
  cancelled: "o.status='cancelled'",
  refunded: "o.payment_status='refunded'",
};

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
