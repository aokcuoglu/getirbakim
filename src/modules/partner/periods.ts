import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { paymentTerms } from "./collections";
import { invoicedDaySql, lockPartnerOrders } from "./limits";
import type { PaymentMethod } from "./payment-methods";

/**
 * Partner period close and monthly statements (#1200). A partner's Istanbul calendar month is closed from
 * /yonetim/partnerler (partner_period_closes); while closed, invoices dated in it (Istanbul invoice day) are not marked,
 * corrected or undone (limits.ts) and payments paid in it (paid_on) are not recorded or voided (collections.ts); the
 * guards (period-guard.ts) and closing/reopening run under the partner's order lock, so a close waits for a running
 * change and the change sees either state. A reopen needs a reason; every close and reopen leaves an event row.
 * Closes are contiguous: a month is closed only when every earlier month with movements (an invoice dated in it or a
 * payment paid in it, voided ones too) is closed, and reopened only when no later month is closed.
 * The statement reads one month as of its end: opening/closing balance = invoice totals dated before the month's
 * start/end − active payments paid before it (voided ones never count; a negative balance is an advance).
 */
type Connection = Pick<PoolClient, "query">;

/** `YYYY-MM` → the period column's date, `YYYY-MM-01`. */
const periodDay = (period: string) => `${period}-01`;

export type PeriodCloseRequest = { partner: string; period: string; note: string; adminId: string | null };
export type PeriodCloseOutcome = { status: "closed" | "already" | "future" } | { status: "gap"; period: string };

/**
 * Closes a month for a partner; idempotent (an already closed month leaves no second event). A future month is refused,
 * and so is a month with an earlier, still open month that has movements (`gap`, the earliest such month).
 */
export async function closePeriod(request: PeriodCloseRequest): Promise<PeriodCloseOutcome> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockPartnerOrders(client, request.partner);
    const { rows } = await client.query<{ future: boolean }>("SELECT $1::text>to_char(now() AT TIME ZONE 'Europe/Istanbul','YYYY-MM') AS future", [request.period]);
    if (rows[0]?.future) { await client.query("ROLLBACK"); return { status: "future" }; }
    const gap = await client.query<{ period: string }>(`SELECT to_char(m,'YYYY-MM') AS period FROM (
       SELECT date_trunc('month',${invoicedDaySql})::date AS m FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND o.partner_invoiced_at IS NOT NULL
       UNION SELECT date_trunc('month',paid_on)::date FROM partner_invoice_payments WHERE partner_code=$1) moved
      WHERE m<$2::date AND NOT EXISTS (SELECT 1 FROM partner_period_closes c WHERE c.partner_code=$1 AND c.period=moved.m) ORDER BY m LIMIT 1`,
    [request.partner, periodDay(request.period)]);
    if (gap.rows[0]) { await client.query("ROLLBACK"); return { status: "gap", period: gap.rows[0].period }; }
    const inserted = await client.query(`INSERT INTO partner_period_closes(partner_code,period,closed_by) VALUES($1,$2::date,$3)
      ON CONFLICT(partner_code,period) DO NOTHING`, [request.partner, periodDay(request.period), request.adminId]);
    if (inserted.rowCount) {
      await client.query("INSERT INTO partner_period_events(partner_code,period,action,reason,actor) VALUES($1,$2::date,'close',$3,$4)",
        [request.partner, periodDay(request.period), request.note, request.adminId]);
    }
    await client.query("COMMIT");
    return { status: inserted.rowCount ? "closed" : "already" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type PeriodReopenRequest = { partner: string; period: string; reason: string; adminId: string | null };
export type PeriodReopenOutcome = { status: "reopened" | "nothing" } | { status: "later"; period: string };

/**
 * Reopens a closed month with a reason; an open month finds nothing and leaves no event. Refused while a later month is
 * closed (`later`, the latest such month): closes are undone from the newest back.
 */
export async function reopenPeriod(request: PeriodReopenRequest): Promise<PeriodReopenOutcome> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockPartnerOrders(client, request.partner);
    const later = await client.query<{ period: string }>(`SELECT to_char(period,'YYYY-MM') AS period FROM partner_period_closes
      WHERE partner_code=$1 AND period>$2::date ORDER BY period DESC LIMIT 1`, [request.partner, periodDay(request.period)]);
    if (later.rows[0]) { await client.query("ROLLBACK"); return { status: "later", period: later.rows[0].period }; }
    const deleted = await client.query("DELETE FROM partner_period_closes WHERE partner_code=$1 AND period=$2::date RETURNING 1",
      [request.partner, periodDay(request.period)]);
    if (deleted.rowCount) {
      await client.query("INSERT INTO partner_period_events(partner_code,period,action,reason,actor) VALUES($1,$2::date,'reopen',$3,$4)",
        [request.partner, periodDay(request.period), request.reason, request.adminId]);
    }
    await client.query("COMMIT");
    return { status: deleted.rowCount ? "reopened" : "nothing" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type ClosedPeriod = { partner: string; period: string; closedAt: Date; closedBy: string | null };

/** Every closed month of the partners, newest month first per partner, with who closed it. */
export async function closedPeriods(partners: string[], connection: Connection = db): Promise<ClosedPeriod[]> {
  const { rows } = await connection.query<{ partner: string; period: string; closed_at: Date; closed_by: string | null }>(
    `SELECT c.partner_code AS partner,to_char(c.period,'YYYY-MM') AS period,c.closed_at,COALESCE(NULLIF(a.name,''),a.email) AS closed_by
     FROM partner_period_closes c LEFT JOIN accounts a ON a.id=c.closed_by WHERE c.partner_code=ANY($1::text[]) ORDER BY 1,2 DESC`, [partners]);
  return rows.map(row => ({ partner: row.partner, period: row.period, closedAt: row.closed_at, closedBy: row.closed_by }));
}

export type PeriodEvent = { id: string; partner: string; period: string; action: "close" | "reopen"; reason: string; actor: string | null; createdAt: Date };

/** The last 50 closes and reopens, newest first. */
export async function periodEvents(partners: string[], connection: Connection = db): Promise<PeriodEvent[]> {
  const { rows } = await connection.query<{ id: string; partner: string; period: string; action: "close" | "reopen"; reason: string; actor: string | null; created_at: Date }>(
    `SELECT e.id::text,e.partner_code AS partner,to_char(e.period,'YYYY-MM') AS period,e.action,e.reason,COALESCE(NULLIF(a.name,''),a.email) AS actor,e.created_at
     FROM partner_period_events e LEFT JOIN accounts a ON a.id=e.actor WHERE e.partner_code=ANY($1::text[]) ORDER BY e.created_at DESC,e.id DESC LIMIT 50`, [partners]);
  return rows.map(row => ({ id: row.id, partner: row.partner, period: row.period, action: row.action, reason: row.reason, actor: row.actor, createdAt: row.created_at }));
}

export type StatementInvoice = { invoiceRef: string; invoiceDate: string; count: number; totalKurus: number; collectedKurus: number };
export type StatementPayment = {
  id: string; invoiceRef: string; invoiceDate: string; amountKurus: number; paidOn: string; method: PaymentMethod; note: string;
  voidedAt: Date | null; voidReason: string | null;
};
export type PartnerStatement = {
  partner: string; period: string;
  /** The day the invoices' collected amounts are read at: the month's last day, or today while the month runs. */
  asOf: string;
  termDays: number | null;
  close: { at: Date; by: string | null } | null;
  openingKurus: number; closingKurus: number;
  invoices: StatementInvoice[];
  /** Paid in the month, voided ones too (listed, never counted). */
  payments: StatementPayment[];
};

/**
 * One partner's month (#1200) from one snapshot: its invoices (Istanbul invoice day in the month) with what was collected
 * on them by `asOf`, the payments paid in the month and the balances at its start and end. `today` is the Istanbul day.
 */
export async function partnerStatement(partner: string, period: string, today: string): Promise<PartnerStatement> {
  const start = periodDay(period);
  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const bounds = await client.query<{ next: string; last_day: string }>(`SELECT to_char(($1::date+interval '1 month')::date,'YYYY-MM-DD') AS next,
      to_char(($1::date+interval '1 month'-interval '1 day')::date,'YYYY-MM-DD') AS last_day`, [start]);
    const { next, last_day: lastDay } = bounds.rows[0];
    const asOf = lastDay < today ? lastDay : today;
    const invoices = await client.query<{ invoice_ref: string; invoice_date: string; count: number; total_kurus: string; collected_kurus: string }>(
      `WITH invoices AS (
        SELECT o.partner_invoice_ref AS invoice_ref,${invoicedDaySql} AS invoice_day,count(*)::int AS count,sum(o.total_kurus) AS total_kurus
        FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND o.partner_invoiced_at IS NOT NULL AND o.partner_invoice_ref IS NOT NULL
         AND ${invoicedDaySql}>=$2::date AND ${invoicedDaySql}<$3::date
        GROUP BY 1,2)
       SELECT i.invoice_ref,to_char(i.invoice_day,'YYYY-MM-DD') AS invoice_date,i.count,i.total_kurus::text,
        (SELECT COALESCE(sum(p.amount_kurus),0) FROM partner_invoice_payments p WHERE p.partner_code=$1 AND p.invoice_ref=i.invoice_ref
          AND p.invoice_day=i.invoice_day AND p.voided_at IS NULL AND p.paid_on<=$4::date)::text AS collected_kurus
       FROM invoices i ORDER BY i.invoice_day,i.invoice_ref`, [partner, start, next, asOf]);
    const payments = await client.query<{ id: string; invoice_ref: string; invoice_date: string; amount_kurus: string; paid_on: string; method: PaymentMethod;
      note: string; voided_at: Date | null; void_reason: string | null }>(
      `SELECT id::text,invoice_ref,to_char(invoice_day,'YYYY-MM-DD') AS invoice_date,amount_kurus::text,to_char(paid_on,'YYYY-MM-DD') AS paid_on,method,note,
        voided_at,void_reason
       FROM partner_invoice_payments WHERE partner_code=$1 AND paid_on>=$2::date AND paid_on<$3::date ORDER BY paid_on,id`, [partner, start, next]);
    const balances = await client.query<{ opening: string; closing: string }>(
      `SELECT
        (SELECT COALESCE(sum(o.total_kurus) FILTER (WHERE ${invoicedDaySql}<$2::date),0)-COALESCE((SELECT sum(amount_kurus) FROM partner_invoice_payments
          WHERE partner_code=$1 AND voided_at IS NULL AND paid_on<$2::date),0)
         FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND o.partner_invoiced_at IS NOT NULL AND o.partner_invoice_ref IS NOT NULL)::text AS opening,
        (SELECT COALESCE(sum(o.total_kurus) FILTER (WHERE ${invoicedDaySql}<$3::date),0)-COALESCE((SELECT sum(amount_kurus) FROM partner_invoice_payments
          WHERE partner_code=$1 AND voided_at IS NULL AND paid_on<$3::date),0)
         FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND o.partner_invoiced_at IS NOT NULL AND o.partner_invoice_ref IS NOT NULL)::text AS closing`,
    [partner, start, next]);
    const terms = await paymentTerms([partner], client);
    const close = await client.query<{ closed_at: Date; closed_by: string | null }>(`SELECT c.closed_at,COALESCE(NULLIF(a.name,''),a.email) AS closed_by
      FROM partner_period_closes c LEFT JOIN accounts a ON a.id=c.closed_by WHERE c.partner_code=$1 AND c.period=$2::date`, [partner, start]);
    await client.query("COMMIT");
    const closed = close.rows[0];
    return {
      partner, period, asOf, termDays: terms.get(partner) ?? null,
      close: closed ? { at: closed.closed_at, by: closed.closed_by } : null,
      openingKurus: Number(balances.rows[0].opening), closingKurus: Number(balances.rows[0].closing),
      invoices: invoices.rows.map(row => ({ invoiceRef: row.invoice_ref, invoiceDate: row.invoice_date, count: row.count, totalKurus: Number(row.total_kurus),
        collectedKurus: Number(row.collected_kurus) })),
      payments: payments.rows.map(row => ({ id: row.id, invoiceRef: row.invoice_ref, invoiceDate: row.invoice_date, amountKurus: Number(row.amount_kurus),
        paidOn: row.paid_on, method: row.method, note: row.note, voidedAt: row.voided_at, voidReason: row.void_reason })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
