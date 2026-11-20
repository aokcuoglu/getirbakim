import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { lockPartnerOrders } from "./limits";
import { PartnerOrderError } from "./quotes";

/**
 * Per-partner order intake switch (#1009). Operations pause a partner in /yonetim/partnerler: from then on its new quotes
 * and new orders are refused with 503 ORDER_INTAKE_PAUSED until it is resumed. Reads, cancels and the idempotent replay
 * of an order created before the pause keep working. Stored on partner_settings (order_intake_paused_at/_by); null = open.
 */
type Connection = Pick<PoolClient, "query">;

export type PartnerIntakePause = { pausedAt: Date; pausedBy: string | null };

/** Paused partners among `partners`, with when and by whom; open partners have no entry. */
export async function pausedPartners(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<{ partner_code: string; paused_at: Date; paused_by: string | null }>(
    `SELECT s.partner_code,s.order_intake_paused_at AS paused_at,COALESCE(NULLIF(a.name,''),a.email) AS paused_by
     FROM partner_settings s LEFT JOIN accounts a ON a.id=s.order_intake_paused_by
     WHERE s.partner_code=ANY($1::text[]) AND s.order_intake_paused_at IS NOT NULL`, [partners]);
  return new Map<string, PartnerIntakePause>(rows.map(row => [row.partner_code, { pausedAt: row.paused_at, pausedBy: row.paused_by }]));
}

/** Throws ORDER_INTAKE_PAUSED (503) when the partner's order intake is paused. */
export async function assertPartnerIntakeOpen(partner: string, connection: Connection = db) {
  const { rowCount } = await connection.query("SELECT 1 FROM partner_settings WHERE partner_code=$1 AND order_intake_paused_at IS NOT NULL", [partner]);
  if (rowCount) throw new PartnerOrderError("ORDER_INTAKE_PAUSED", "Order intake is paused for this partner.", 503);
}

/**
 * Pauses or resumes a partner's order intake under its order lock, so an order being placed sees either state. Pausing
 * an already paused partner keeps the first pause's time and admin; resuming clears both. The limit is untouched.
 */
export async function setPartnerIntakePaused(partner: string, paused: boolean, adminId: string | null) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await lockPartnerOrders(client, partner);
    if (paused) {
      await client.query(`INSERT INTO partner_settings(partner_code,order_intake_paused_at,order_intake_paused_by) VALUES($1,now(),$2)
        ON CONFLICT(partner_code) DO UPDATE SET order_intake_paused_by=CASE WHEN partner_settings.order_intake_paused_at IS NULL
          THEN excluded.order_intake_paused_by ELSE partner_settings.order_intake_paused_by END,
          order_intake_paused_at=COALESCE(partner_settings.order_intake_paused_at,excluded.order_intake_paused_at)`, [partner, adminId]);
    } else {
      await client.query("UPDATE partner_settings SET order_intake_paused_at=NULL,order_intake_paused_by=NULL WHERE partner_code=$1", [partner]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
