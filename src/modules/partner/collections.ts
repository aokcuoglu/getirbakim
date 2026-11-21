import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { activeCollectedKurus, invoicedDaySql, lockPartnerOrders } from "./limits";
import type { PaymentMethod } from "./payment-methods";

/**
 * Collections against partner invoices (#1006). Operations record what a partner paid towards one invoice (the partner's
 * marked orders sharing a number and Istanbul invoice day, limits.ts) in /yonetim/partnerler; several partial payments
 * per invoice are allowed, over-payment is not: the active payments never exceed the invoice's total. A wrong payment is
 * voided with a reason, never edited or deleted. Recording and voiding run under the partner's order lock, like the
 * invoice corrections and undos that change an invoice's total. Payments never change the open-order limit and are not
 * part of the partner API.
 */
type Connection = Pick<PoolClient, "query">;

/** The total of the partner's invoice (its marked orders), or null when no order carries that number and day any more. */
async function invoiceTotalKurus(client: Connection, partner: string, invoiceRef: string, invoiceDay: string) {
  const { rows } = await client.query<{ count: number; kurus: string }>(`SELECT count(*)::int AS count,COALESCE(sum(o.total_kurus),0)::text AS kurus
    FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND o.partner_invoice_ref=$2 AND o.partner_invoiced_at IS NOT NULL
    AND ${invoicedDaySql}=$3::date`, [partner, invoiceRef, invoiceDay]);
  return rows[0]?.count ? Number(rows[0].kurus) : null;
}

export type PaymentRequest = {
  partner: string; invoiceRef: string; invoiceDate: string; amountKurus: number; paidOn: string; method: PaymentMethod; note: string;
  /** The admin who records it (recorded_by); null only in tests without an account. */
  adminId: string | null;
  /** What the dialog showed: a different total or collected amount (a double submit, a change meanwhile) is refused. */
  expected: { totalKurus: number; collectedKurus: number };
};
export type PaymentOutcome =
  | { status: "recorded"; id: string; balanceKurus: number }
  | { status: "nothing" } | { status: "changed" } | { status: "overpaid"; balanceKurus: number };

/** Records one payment against an invoice; refused when the invoice is gone, changed since shown, or would be over-paid. */
export async function recordInvoicePayment(request: PaymentRequest): Promise<PaymentOutcome> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockPartnerOrders(client, request.partner);
    const totalKurus = await invoiceTotalKurus(client, request.partner, request.invoiceRef, request.invoiceDate);
    if (totalKurus == null) { await client.query("ROLLBACK"); return { status: "nothing" }; }
    const collectedKurus = await activeCollectedKurus(client, request.partner, request.invoiceRef, request.invoiceDate);
    if (totalKurus !== request.expected.totalKurus || collectedKurus !== request.expected.collectedKurus) { await client.query("ROLLBACK"); return { status: "changed" }; }
    const balanceKurus = totalKurus - collectedKurus;
    if (request.amountKurus > balanceKurus) { await client.query("ROLLBACK"); return { status: "overpaid", balanceKurus }; }
    const { rows } = await client.query<{ id: string }>(`INSERT INTO partner_invoice_payments(partner_code,invoice_ref,invoice_day,amount_kurus,paid_on,method,note,recorded_by)
      VALUES($1,$2,$3::date,$4,$5::date,$6,$7,$8) RETURNING id::text`,
    [request.partner, request.invoiceRef, request.invoiceDate, request.amountKurus, request.paidOn, request.method, request.note, request.adminId]);
    await client.query("COMMIT");
    return { status: "recorded", id: rows[0].id, balanceKurus: balanceKurus - request.amountKurus };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type PaymentVoidRequest = { paymentId: string; reason: string; adminId: string | null };
export type PaymentVoidOutcome = { status: "voided"; partner: string } | { status: "nothing" };

/** Voids an active payment with a reason; the invoice's balance opens again. A voided or unknown payment finds nothing. */
export async function voidInvoicePayment(request: PaymentVoidRequest): Promise<PaymentVoidOutcome> {
  const owner = await db.query<{ partner_code: string }>("SELECT partner_code FROM partner_invoice_payments WHERE id=$1", [request.paymentId]);
  const partner = owner.rows[0]?.partner_code;
  if (!partner) return { status: "nothing" };
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockPartnerOrders(client, partner);
    const { rowCount } = await client.query("UPDATE partner_invoice_payments SET voided_at=now(),voided_by=$2,void_reason=$3 WHERE id=$1 AND voided_at IS NULL",
      [request.paymentId, request.adminId, request.reason]);
    await client.query("COMMIT");
    return rowCount ? { status: "voided", partner } : { status: "nothing" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type LedgerInvoice = {
  partner: string; invoiceRef: string; invoiceDate: string; count: number; totalKurus: number; collectedKurus: number;
};

/**
 * Marked invoices with their active payments, newest first: every invoice with a balance (what can still be collected,
 * however old), plus the newest 100 settled ones.
 */
export async function partnerInvoiceLedger(partners: string[], connection: Connection = db): Promise<LedgerInvoice[]> {
  const { rows } = await connection.query<{ partner: string; invoice_ref: string; invoice_date: string; count: number; total_kurus: string;
    collected_kurus: string }>(
    `WITH invoices AS (
      SELECT o.owner_id AS partner,o.partner_invoice_ref AS invoice_ref,${invoicedDaySql} AS invoice_day,count(*)::int AS count,sum(o.total_kurus) AS total_kurus
      FROM commerce_orders o
      WHERE o.owner_kind='partner' AND o.owner_id=ANY($1::text[]) AND o.partner_invoiced_at IS NOT NULL AND o.partner_invoice_ref IS NOT NULL
      GROUP BY 1,2,3),
     paid AS (
      SELECT partner_code,invoice_ref,invoice_day,sum(amount_kurus) AS kurus FROM partner_invoice_payments
      WHERE partner_code=ANY($1::text[]) AND voided_at IS NULL GROUP BY 1,2,3),
     ledger AS (
      SELECT i.*,COALESCE(p.kurus,0) AS collected_kurus,
       row_number() OVER (PARTITION BY i.total_kurus>COALESCE(p.kurus,0) ORDER BY i.invoice_day DESC,i.invoice_ref) AS position
      FROM invoices i LEFT JOIN paid p ON p.partner_code=i.partner AND p.invoice_ref=i.invoice_ref AND p.invoice_day=i.invoice_day)
     SELECT partner,invoice_ref,to_char(invoice_day,'YYYY-MM-DD') AS invoice_date,count,total_kurus::text,collected_kurus::text
     FROM ledger WHERE total_kurus>collected_kurus OR position<=100 ORDER BY invoice_day DESC,invoice_ref`, [partners]);
  return rows.map(row => ({ partner: row.partner, invoiceRef: row.invoice_ref, invoiceDate: row.invoice_date, count: row.count, totalKurus: Number(row.total_kurus),
    collectedKurus: Number(row.collected_kurus) }));
}

export type InvoicePayment = {
  id: string; partner: string; invoiceRef: string; invoiceDate: string; amountKurus: number; paidOn: string; method: PaymentMethod; note: string;
  recordedBy: string | null; recordedAt: Date; voidedAt: Date | null; voidedBy: string | null; voidReason: string | null;
};

/**
 * Every active payment (each must stay voidable: a void is the only way to fix one, and an undo waits for it) plus the
 * last 50 voided ones, newest first, with who recorded and who voided them.
 */
export async function recentInvoicePayments(partners: string[], connection: Connection = db): Promise<InvoicePayment[]> {
  const { rows } = await connection.query<{ id: string; partner: string; invoice_ref: string; invoice_date: string; amount_kurus: string; paid_on: string;
    method: PaymentMethod; note: string; recorded_by: string | null; recorded_at: Date; voided_at: Date | null; voided_by: string | null; void_reason: string | null }>(
    `WITH listed AS (
      SELECT * FROM partner_invoice_payments WHERE partner_code=ANY($1::text[]) AND voided_at IS NULL
      UNION ALL
      (SELECT * FROM partner_invoice_payments WHERE partner_code=ANY($1::text[]) AND voided_at IS NOT NULL ORDER BY recorded_at DESC,id DESC LIMIT 50))
     SELECT p.id::text,p.partner_code AS partner,p.invoice_ref,to_char(p.invoice_day,'YYYY-MM-DD') AS invoice_date,p.amount_kurus::text,
      to_char(p.paid_on,'YYYY-MM-DD') AS paid_on,p.method,p.note,COALESCE(NULLIF(r.name,''),r.email) AS recorded_by,p.recorded_at,p.voided_at,
      COALESCE(NULLIF(v.name,''),v.email) AS voided_by,p.void_reason
     FROM listed p LEFT JOIN accounts r ON r.id=p.recorded_by LEFT JOIN accounts v ON v.id=p.voided_by
     ORDER BY p.recorded_at DESC,p.id DESC`, [partners]);
  return rows.map(row => ({ id: row.id, partner: row.partner, invoiceRef: row.invoice_ref, invoiceDate: row.invoice_date, amountKurus: Number(row.amount_kurus),
    paidOn: row.paid_on, method: row.method, note: row.note, recordedBy: row.recorded_by, recordedAt: row.recorded_at, voidedAt: row.voided_at,
    voidedBy: row.voided_by, voidReason: row.void_reason }));
}

/**
 * Active payments whose invoice no longer exists (no marked order carries its number and day). The app refuses the undo
 * that would cause this; a count above zero means a change outside the app and needs a look.
 */
export async function orphanPaymentCount(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<{ count: number }>(`SELECT count(*)::int AS count FROM partner_invoice_payments p
    WHERE p.partner_code=ANY($1::text[]) AND p.voided_at IS NULL AND NOT EXISTS (SELECT 1 FROM commerce_orders o WHERE o.owner_kind='partner'
     AND o.owner_id=p.partner_code AND o.partner_invoice_ref=p.invoice_ref AND o.partner_invoiced_at IS NOT NULL AND ${invoicedDaySql}=p.invoice_day)`, [partners]);
  return rows[0]?.count ?? 0;
}

/** The payment term (days) of each partner that has one. */
export async function paymentTerms(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<{ partner_code: string; payment_term_days: number }>(
    "SELECT partner_code,payment_term_days FROM partner_settings WHERE partner_code=ANY($1::text[]) AND payment_term_days IS NOT NULL", [partners]);
  return new Map(rows.map(row => [row.partner_code, row.payment_term_days]));
}

/** Saves (or with null clears) the partner's payment term; due dates follow at once, nothing else changes. */
export async function savePartnerPaymentTerm(partner: string, days: number | null, adminId: string | null) {
  await db.query(`INSERT INTO partner_settings(partner_code,payment_term_days,updated_by) VALUES($1,$2,$3)
    ON CONFLICT(partner_code) DO UPDATE SET payment_term_days=excluded.payment_term_days,updated_at=now(),updated_by=excluded.updated_by`,
  [partner, days, adminId]);
}
