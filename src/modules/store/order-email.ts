import "server-only";
// Kept free of the session and next/* so the outbox can be driven from tests and after() alike (like purchase-event.ts).
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { sendMail, type MailMessage, type MailResult } from "@/lib/mail";
import { contactEmail, contactPhone, siteName, siteUrl } from "@/lib/site";
import { money } from "./money";
import type { CommerceOrder } from "./orders";
import { invoiceAddressText, invoiceSummary, invoiceTypes } from "./tr-address";

/**
 * Order confirmation email (#951). recordPaid queues one row per order in the payment transaction that settles it;
 * deliverOrderEmails claims pending rows with a lease and sends them after the response (after()) or from the 5-minute
 * payment sweep. A row is sent at most once per claim; a failed send is retried on a later claim up to MAX_ATTEMPTS.
 */
const LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const STALE_HOURS = 24;

export type ConfirmationOrder = Pick<CommerceOrder,
  "id" | "number" | "customer_name" | "phone" | "address" | "note" | "created_at" | "subtotal_kurus" | "shipping_kurus" | "total_kurus"
  | "discount_percent" | "installment_count" | "installment_fee_kurus" | "invoice_type" | "invoice_company" | "invoice_tax_no" | "invoice_tax_office"
  | "invoice_province" | "invoice_district" | "invoice_address_line" | "invoice_postal_code">;
export type ConfirmationItem = { name: string; code: string; quantity: number; unit_price_kurus: string };
export type ConfirmationData = { order: ConfirmationOrder; items: ConfirmationItem[]; hasAgreement: boolean; baseUrl: string };

const colors = { text: "#222831", muted: "#626b75", link: "#0077c7", divider: "#e5e7eb" };

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const html = (value: string) => escapeHtml(value).replace(/\r?\n/g, "<br>");
const time = (value: Date) => new Date(value).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long", timeStyle: "short" });
/** +902163870078 → +90 216 387 00 78 */
const phoneLabel = (phone: string) => phone.replace(/^\+90(\d{3})(\d{3})(\d{2})(\d{2})$/, "+90 $1 $2 $3 $4");

/** Subject, plain text and HTML of the confirmation; every customer-sourced value is escaped in the HTML. */
export function buildOrderConfirmation({ order, items, hasAgreement, baseUrl }: ConfirmationData): Omit<MailMessage, "to" | "messageId"> {
  const base = baseUrl.replace(/\/$/, "");
  const orderUrl = `${base}/siparis/${order.id}`;
  const links = [
    { label: "Siparişini görüntüle", url: orderUrl },
    ...(hasAgreement ? [{ label: "Sözleşme kopyan", url: `${orderUrl}/sozlesme` }] : []),
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
  const pageNote = "Sipariş sayfası, siparişi verdiğin hesapla ya da siparişi verdiğin tarayıcıdan açılır.";
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
export type DeliverResult = { sent: number; skipped: number; failed: number };

const confirmationColumns = "id,number,email,customer_name,phone,address,note,created_at,subtotal_kurus,shipping_kurus,total_kurus,discount_percent,installment_count,installment_fee_kurus,invoice_type,invoice_company,invoice_tax_no,invoice_tax_office,invoice_province,invoice_district,invoice_address_line,invoice_postal_code";

async function confirmationMessage(orderId: string) {
  const [order, items, agreement] = await Promise.all([
    db.query<ConfirmationOrder & { email: string }>(`SELECT ${confirmationColumns} FROM commerce_orders WHERE id=$1`, [orderId]),
    db.query<ConfirmationItem>("SELECT name,code,quantity,unit_price_kurus FROM commerce_order_items WHERE order_id=$1 ORDER BY code,product_id", [orderId]),
    db.query("SELECT 1 FROM commerce_order_agreements WHERE order_id=$1", [orderId]),
  ]);
  const row = order.rows[0];
  if (!row) throw new Error("Order not found");
  const content = buildOrderConfirmation({ order: row, items: items.rows, hasAgreement: Boolean(agreement.rowCount), baseUrl: siteUrl });
  // Deterministic, so a resend after a lost reply is recognisable as the same message.
  return { number: row.number, message: { ...content, to: row.email, messageId: `<order-${orderId}-confirmation@${new URL(siteUrl).hostname}>` } };
}

/**
 * Sends pending order emails: all of them (oldest first, up to `limit`) or only `orderId`'s. Rows older than a day are
 * skipped as stale. Each row is claimed atomically (SKIP LOCKED plus a lease), so concurrent calls never send it twice.
 */
export async function deliverOrderEmails({ orderId, limit = 10, send = message => sendMail(message) }: DeliverOptions = {}): Promise<DeliverResult> {
  const only = orderId ?? null;
  await db.query(
    `UPDATE commerce_order_emails SET status='skipped',last_error='stale' WHERE status='pending'
     AND created_at < now()-make_interval(hours=>$2) AND ($1::uuid IS NULL OR order_id=$1)
     AND (claimed_at IS NULL OR claimed_at < now()-make_interval(mins=>$3))`, [only, STALE_HOURS, LEASE_MINUTES],
  );
  const claimed = (await db.query<{ order_id: string; kind: string; attempts: number }>(
    `UPDATE commerce_order_emails SET claimed_at=now(),attempts=attempts+1 WHERE (order_id,kind) IN (
       SELECT order_id,kind FROM commerce_order_emails WHERE status='pending' AND ($1::uuid IS NULL OR order_id=$1)
        AND (claimed_at IS NULL OR claimed_at < now()-make_interval(mins=>$3))
       ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
     RETURNING order_id::text,kind,attempts`, [only, limit, LEASE_MINUTES],
  )).rows;
  const result: DeliverResult = { sent: 0, skipped: 0, failed: 0 };
  for (const row of claimed) {
    let number: string | null = null;
    try {
      const built = await confirmationMessage(row.order_id);
      number = built.number;
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
      const failed = row.attempts >= MAX_ATTEMPTS;
      await db.query(`UPDATE commerce_order_emails SET last_error=$3,status=CASE WHEN $4 THEN 'failed' ELSE status END WHERE order_id=$1 AND kind=$2`,
        [row.order_id, row.kind, message.slice(0, 500), failed]);
      // Never the address or name: a provider's message may carry them, so only its code is logged.
      const code = error instanceof Error && "code" in error ? String(error.code) : null;
      console.error("Order email failed", { order: number ?? row.order_id, attempt: row.attempts, final: failed, code });
      if (failed) result.failed++;
    }
  }
  return result;
}

/** deliverOrderEmails for after(): logs instead of throwing, so a mail problem never reaches the payment flow. */
export async function deliverOrderEmailsSafely(options: DeliverOptions = {}) {
  try { return await deliverOrderEmails(options); }
  catch (error) {
    console.error("Order email delivery failed", { error: error instanceof Error ? error.message : error });
    return null;
  }
}
