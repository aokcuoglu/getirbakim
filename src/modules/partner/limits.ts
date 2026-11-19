import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { parsePartnerKeys, partnerKeysEnv } from "./auth";

/**
 * Partner credit (#426). A partner orders on account up to its open-order limit; what counts against it (its exposure)
 * is every order that is neither cancelled nor delivered, plus delivered orders operations have not invoiced yet
 * (gross totals, shipping included). Marking a delivered order invoiced in /yonetim/partnerler releases it; collection
 * is not tracked here. The limit is the partner's /yonetim value (partner_settings), else the PARTNER_ORDER_LIMIT_KURUS
 * fallback; with neither the partner cannot order (fail closed). Order creation and the admin page read the same SQL.
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
