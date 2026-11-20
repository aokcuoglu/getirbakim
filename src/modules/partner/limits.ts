import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { parsePartnerKeys, partnerKeysEnv } from "./auth";

/**
 * Partner credit (#426). A partner orders on account up to its open-order limit; what counts against it (its exposure)
 * is every order that is neither cancelled nor delivered, plus delivered orders operations have not invoiced yet
 * (gross totals, shipping included). Marking a delivered order invoiced in /yonetim/partnerler releases it; collection
 * is not tracked here. The limit is the partner's /yonetim value (partner_settings), else the PARTNER_ORDER_LIMIT_KURUS
 * fallback; with neither the partner cannot order (fail closed). Order creation and the admin page read the same SQL.
 * A wrong mark is corrected (invoice number/date) or undone per invoice with a reason (#1018, partner_invoice_changes);
 * an undone order counts against the limit again.
 */
type Connection = Pick<PoolClient, "query">;

export type PartnerLimitSource = "panel" | "env" | "none";
export type PartnerLimit = { limitKurus: number | null; source: PartnerLimitSource };
export type PartnerExposure = { openKurus: number; openCount: number; uninvoicedKurus: number; uninvoicedCount: number; exposureKurus: number };

/** Open: still on its way (pending, confirmed, shipped). */
const openSql = "o.status NOT IN ('cancelled','delivered')";
/** Delivered and not invoiced yet: owed, still counted. */
const uninvoicedSql = "o.status='delivered' AND o.partner_invoiced_at IS NULL";

/** The Istanbul calendar day an order was delivered (orders delivered before delivered_at existed fall back to creation). */
const deliveredDaySql = "(COALESCE(o.delivered_at,o.created_at) AT TIME ZONE 'Europe/Istanbul')::date";

/** The Istanbul calendar day an order was marked invoiced (marking stores that day's Istanbul midnight). */
const invoicedDaySql = "(o.partner_invoiced_at AT TIME ZONE 'Europe/Istanbul')::date";

/**
 * One order decision at a time per partner: order creation (the limit and Idempotency-Key check) and undoing an invoiced
 * mark (which adds to the exposure) both hold it until their transaction ends.
 */
export async function lockPartnerOrders(client: Connection, partner: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`partner_order:${partner}`]);
}

/** Exposure per partner for `$1::text[]` partner codes; partners without counted orders have no row. */
export const partnerExposureSql = `SELECT o.owner_id AS partner,
  COALESCE(sum(o.total_kurus) FILTER (WHERE ${openSql}),0)::text AS open_kurus, count(*) FILTER (WHERE ${openSql})::int AS open_count,
  COALESCE(sum(o.total_kurus) FILTER (WHERE ${uninvoicedSql}),0)::text AS uninvoiced_kurus, count(*) FILTER (WHERE ${uninvoicedSql})::int AS uninvoiced_count
  FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=ANY($1::text[]) AND ((${openSql}) OR (${uninvoicedSql}))
  GROUP BY o.owner_id`;

type ExposureRow = { partner: string; open_kurus: string; open_count: number; uninvoiced_kurus: string; uninvoiced_count: number };
export const noExposure: PartnerExposure = { openKurus: 0, openCount: 0, uninvoicedKurus: 0, uninvoicedCount: 0, exposureKurus: 0 };

export async function partnerExposures(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<ExposureRow>(partnerExposureSql, [partners]);
  const found = new Map(rows.map(row => {
    const openKurus = Number(row.open_kurus), uninvoicedKurus = Number(row.uninvoiced_kurus);
    return [row.partner, { openKurus, openCount: row.open_count, uninvoicedKurus, uninvoicedCount: row.uninvoiced_count, exposureKurus: openKurus + uninvoicedKurus }];
  }));
  return new Map(partners.map(partner => [partner, found.get(partner) ?? noExposure]));
}

export async function partnerExposure(partner: string, connection: Connection = db) {
  return (await partnerExposures([partner], connection)).get(partner) ?? noExposure;
}

/** The panel's limit for each partner that has one. */
export async function panelLimits(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<{ partner_code: string; order_limit_kurus: string }>(
    "SELECT partner_code,order_limit_kurus::text FROM partner_settings WHERE partner_code=ANY($1::text[]) AND order_limit_kurus IS NOT NULL", [partners]);
  return new Map(rows.map(row => [row.partner_code, Number(row.order_limit_kurus)]));
}

/** Panel value first, then the deployment fallback (`fallbackKurus`, PARTNER_ORDER_LIMIT_KURUS), else none. */
export function resolvePartnerLimit(panelKurus: number | undefined, fallbackKurus: number | null): PartnerLimit {
  if (panelKurus !== undefined) return { limitKurus: panelKurus, source: "panel" };
  if (fallbackKurus != null) return { limitKurus: fallbackKurus, source: "env" };
  return { limitKurus: null, source: "none" };
}

export async function partnerOrderLimit(partner: string, fallbackKurus: number | null, connection: Connection = db) {
  return resolvePartnerLimit((await panelLimits([partner], connection)).get(partner), fallbackKurus);
}

/** Partners the admin page lists: configured keys, partners with orders, and partners with a saved setting. */
export async function knownPartners(connection: Connection = db) {
  const { rows } = await connection.query<{ code: string }>(`SELECT DISTINCT owner_id AS code FROM commerce_orders WHERE owner_kind='partner'
    UNION SELECT partner_code FROM partner_settings`);
  const configured = [...parsePartnerKeys(process.env[partnerKeysEnv]).values()];
  return { codes: [...new Set([...configured, ...rows.map(row => row.code)])].sort(), configured: new Set(configured) };
}

/** Delivered, uninvoiced orders per delivery day (Europe/Istanbul), for the invoice dialog's preview. */
export async function uninvoicedDays(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<{ partner: string; day: string; count: number; total_kurus: string }>(
    `SELECT o.owner_id AS partner,to_char(${deliveredDaySql},'YYYY-MM-DD') AS day,count(*)::int AS count,sum(o.total_kurus)::text AS total_kurus
     FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=ANY($1::text[]) AND ${uninvoicedSql} GROUP BY 1,2 ORDER BY 1,2`, [partners]);
  const days = new Map<string, { day: string; count: number; totalKurus: number }[]>();
  for (const row of rows) days.set(row.partner, [...days.get(row.partner) ?? [], { day: row.day, count: row.count, totalKurus: Number(row.total_kurus) }]);
  return days;
}

export type InvoiceRequest = {
  partner: string; deliveredUntil: string; invoiceRef: string; invoiceDate: string;
  /** The admin who marks them (partner_invoiced_by); null only in tests without an account. */
  adminId: string | null;
  /** What the dialog showed: anything else (an order delivered or invoiced meanwhile) is refused, nothing is marked. */
  expected: { count: number; totalKurus: number };
};
export type InvoiceOutcome = { status: "invoiced"; count: number; totalKurus: number } | { status: "changed" } | { status: "nothing" };

/**
 * Marks the partner's delivered, uninvoiced orders delivered on or before `deliveredUntil` (Istanbul day) as invoiced
 * with one invoice number and date. Idempotent: invoiced orders are never touched again, so a repeated submit finds
 * nothing to mark. Other partners' and store orders are out of reach.
 */
export async function invoicePartnerOrders(request: InvoiceRequest): Promise<InvoiceOutcome> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; total_kurus: string }>(
      `SELECT o.id::text,o.total_kurus::text FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND ${uninvoicedSql}
       AND ${deliveredDaySql}<=$2::date ORDER BY o.id FOR UPDATE`, [request.partner, request.deliveredUntil]);
    const totalKurus = rows.reduce((sum, row) => sum + Number(row.total_kurus), 0);
    if (!rows.length) { await client.query("ROLLBACK"); return { status: "nothing" }; }
    if (rows.length !== request.expected.count || totalKurus !== request.expected.totalKurus) { await client.query("ROLLBACK"); return { status: "changed" }; }
    await client.query(`UPDATE commerce_orders SET partner_invoiced_at=($2::date)::timestamp AT TIME ZONE 'Europe/Istanbul',partner_invoice_ref=$3,partner_invoiced_by=$4
      WHERE id=ANY($1::uuid[]) AND partner_invoiced_at IS NULL`, [rows.map(row => row.id), request.invoiceDate, request.invoiceRef, request.adminId]);
    await client.query("COMMIT");
    return { status: "invoiced", count: rows.length, totalKurus };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Saves (or with null clears) the partner's panel limit; the fallback applies again once it is cleared. */
export async function savePartnerOrderLimit(partner: string, limitKurus: number | null, adminId: string | null) {
  await db.query(`INSERT INTO partner_settings(partner_code,order_limit_kurus,updated_by) VALUES($1,$2,$3)
    ON CONFLICT(partner_code) DO UPDATE SET order_limit_kurus=excluded.order_limit_kurus,updated_at=now(),updated_by=excluded.updated_by`,
  [partner, limitKurus, adminId]);
}

export type PartnerInvoice = { partner: string; invoiceRef: string; invoiceDate: string; count: number; totalKurus: number; markedBy: string | null };

/** Marked invoices (partner, number, Istanbul day), newest first: the unit a mark is corrected or undone in. */
export async function partnerInvoices(partners: string[], connection: Connection = db): Promise<PartnerInvoice[]> {
  const { rows } = await connection.query<{ partner: string; invoice_ref: string; invoice_date: string; count: number; total_kurus: string; marked_by: string | null }>(
    `SELECT o.owner_id AS partner,o.partner_invoice_ref AS invoice_ref,to_char(${invoicedDaySql},'YYYY-MM-DD') AS invoice_date,count(*)::int AS count,
      sum(o.total_kurus)::text AS total_kurus,string_agg(DISTINCT COALESCE(NULLIF(a.name,''),a.email),', ') AS marked_by
     FROM commerce_orders o LEFT JOIN accounts a ON a.id=o.partner_invoiced_by
     WHERE o.owner_kind='partner' AND o.owner_id=ANY($1::text[]) AND o.partner_invoiced_at IS NOT NULL AND o.partner_invoice_ref IS NOT NULL
     GROUP BY 1,2,3 ORDER BY 3 DESC,2 LIMIT 100`, [partners]);
  return rows.map(row => ({ partner: row.partner, invoiceRef: row.invoice_ref, invoiceDate: row.invoice_date, count: row.count, totalKurus: Number(row.total_kurus), markedBy: row.marked_by }));
}

export type PartnerInvoiceChange = {
  changeId: string; partner: string; action: "undo" | "correct"; oldRef: string; oldDate: string; newRef: string | null; newDate: string | null;
  reason: string; changedBy: string | null; changedAt: Date; count: number;
};

/** The last corrections and undos, one row per change (its orders share change_id), newest first. */
export async function partnerInvoiceChanges(partners: string[], connection: Connection = db): Promise<PartnerInvoiceChange[]> {
  const day = (column: string) => `to_char((${column} AT TIME ZONE 'Europe/Istanbul')::date,'YYYY-MM-DD')`;
  const { rows } = await connection.query<{ change_id: string; partner: string; action: "undo" | "correct"; old_ref: string; old_date: string; new_ref: string | null;
    new_date: string | null; reason: string; changed_by: string | null; changed_at: Date; count: number }>(
    `SELECT c.change_id::text,c.partner_code AS partner,c.action,c.old_invoice_ref AS old_ref,${day("c.old_invoiced_at")} AS old_date,
      c.new_invoice_ref AS new_ref,${day("c.new_invoiced_at")} AS new_date,c.reason,COALESCE(NULLIF(a.name,''),a.email) AS changed_by,c.changed_at,count(*)::int AS count
     FROM partner_invoice_changes c LEFT JOIN accounts a ON a.id=c.changed_by WHERE c.partner_code=ANY($1::text[])
     GROUP BY 1,2,3,4,5,6,7,8,9,10 ORDER BY c.changed_at DESC,1 LIMIT 50`, [partners]);
  return rows.map(row => ({ changeId: row.change_id, partner: row.partner, action: row.action, oldRef: row.old_ref, oldDate: row.old_date, newRef: row.new_ref,
    newDate: row.new_date, reason: row.reason, changedBy: row.changed_by, changedAt: row.changed_at, count: row.count }));
}

export type InvoiceChangeRequest = {
  partner: string; invoiceRef: string; invoiceDate: string; reason: string;
  /** The admin who changes it (partner_invoice_changes.changed_by); null only in tests without an account. */
  adminId: string | null;
  /** What the dialog showed: anything else (the invoice changed meanwhile) is refused, nothing is written. */
  expected: { count: number; totalKurus: number };
} & ({ action: "undo" } | { action: "correct"; newInvoiceRef: string; newInvoiceDate: string });
export type InvoiceChangeOutcome = { status: "undone" | "corrected"; count: number; totalKurus: number } | { status: "changed" } | { status: "nothing" } | { status: "same" } | { status: "merge" };

/**
 * Corrects (new number/date, the marking admin is kept) or undoes one marked invoice of a partner, with an audit row
 * per order. Undone orders count against the limit again; orders already placed stay, only new ones may be refused.
 * Runs under the partner's order lock so an order being placed sees either the mark or its undo.
 */
export async function changePartnerInvoice(request: InvoiceChangeRequest): Promise<InvoiceChangeOutcome> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockPartnerOrders(client, request.partner);
    const { rows } = await client.query<{ id: string; total_kurus: string }>(
      `SELECT o.id::text,o.total_kurus::text FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND o.partner_invoice_ref=$2
       AND o.partner_invoiced_at IS NOT NULL AND ${invoicedDaySql}=$3::date ORDER BY o.id FOR UPDATE`, [request.partner, request.invoiceRef, request.invoiceDate]);
    const totalKurus = rows.reduce((sum, row) => sum + Number(row.total_kurus), 0);
    if (!rows.length) { await client.query("ROLLBACK"); return { status: "nothing" }; }
    if (rows.length !== request.expected.count || totalKurus !== request.expected.totalKurus) { await client.query("ROLLBACK"); return { status: "changed" }; }
    const correct = request.action === "correct" ? request : null;
    if (correct && correct.newInvoiceRef === request.invoiceRef && correct.newInvoiceDate === request.invoiceDate) { await client.query("ROLLBACK"); return { status: "same" }; }
    // Another invoice of the partner with the new number and day would silently absorb these orders.
    if (correct && (await client.query(`SELECT 1 FROM commerce_orders o WHERE o.owner_kind='partner' AND o.owner_id=$1 AND o.partner_invoice_ref=$2
      AND o.partner_invoiced_at IS NOT NULL AND ${invoicedDaySql}=$3::date LIMIT 1`, [request.partner, correct.newInvoiceRef, correct.newInvoiceDate])).rowCount) {
      await client.query("ROLLBACK"); return { status: "merge" };
    }
    const ids = rows.map(row => row.id);
    const newAt = "($3::date)::timestamp AT TIME ZONE 'Europe/Istanbul'";
    await client.query(`INSERT INTO partner_invoice_changes(change_id,order_id,partner_code,action,old_invoice_ref,old_invoiced_at,old_invoiced_by,new_invoice_ref,new_invoiced_at,reason,changed_by)
      SELECT $4::uuid,o.id,o.owner_id,$5,o.partner_invoice_ref,o.partner_invoiced_at,o.partner_invoiced_by,$2,${newAt},$6,$7 FROM commerce_orders o WHERE o.id=ANY($1::uuid[])`,
    [ids, correct?.newInvoiceRef ?? null, correct?.newInvoiceDate ?? null, randomUUID(), request.action, request.reason, request.adminId]);
    if (correct) await client.query(`UPDATE commerce_orders SET partner_invoice_ref=$2,partner_invoiced_at=${newAt} WHERE id=ANY($1::uuid[])`,
      [ids, correct.newInvoiceRef, correct.newInvoiceDate]);
    else await client.query("UPDATE commerce_orders SET partner_invoiced_at=NULL,partner_invoice_ref=NULL,partner_invoiced_by=NULL WHERE id=ANY($1::uuid[])", [ids]);
    await client.query("COMMIT");
    return { status: correct ? "corrected" : "undone", count: rows.length, totalKurus };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
