import "server-only";
import type { PoolClient } from "pg";
import { db } from "@/lib/db";
import { ttlCache } from "@/lib/ttl-cache";
import { lockPartnerOrders } from "./limits";
import { resolvePartnerDiscount } from "./pricing";

/**
 * Per-partner B2B discount (#1130), set in /yonetim/partnerler and stored on partner_settings.discount_bps (basis
 * points, 0–9000; NULL falls back to PARTNER_B2B_DISCOUNT_BPS, then no discount). The products endpoint reads it through
 * a short process cache; quotes and orders read it fresh, the order inside its transaction, so a change between a quote
 * and its order surfaces as PRICE_CHANGED (the quote binds the unit prices). Every change leaves a partner_discount_changes row.
 */
type Connection = Pick<PoolClient, "query">;

/** How long one process keeps a partner's panel discount for the products endpoint; saving drops it at once in this process. */
export const partnerDiscountTtlMs = 5_000;

/** The panel discount for each partner that has one. */
export async function panelDiscounts(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<{ partner_code: string; discount_bps: number }>(
    "SELECT partner_code,discount_bps FROM partner_settings WHERE partner_code=ANY($1::text[]) AND discount_bps IS NOT NULL", [partners]);
  return new Map(rows.map(row => [row.partner_code, row.discount_bps]));
}

/** The partner's discount, read now (quotes, orders). `fallbackBps` is the deployment's PARTNER_B2B_DISCOUNT_BPS. */
export async function partnerDiscount(partner: string, fallbackBps: number, connection: Connection = db) {
  return resolvePartnerDiscount((await panelDiscounts([partner], connection)).get(partner), fallbackBps);
}

const cachedPanel = ttlCache<number | null>(partnerDiscountTtlMs, 100);
// Saving bumps the generation, so this process never serves a discount read before the save again.
let generation = 0;

/** The partner's discount for the products endpoint, at most partnerDiscountTtlMs old in other processes. */
export async function cachedPartnerDiscount(partner: string, fallbackBps: number) {
  const panel = await cachedPanel(`${generation}:${partner}`, async () => (await panelDiscounts([partner])).get(partner) ?? null);
  return resolvePartnerDiscount(panel, fallbackBps);
}

/**
 * Saves (or with null clears) the partner's panel discount with an audit row of the old and new value. The row is locked
 * so two saves record a consistent history; nothing is recorded when the value does not change.
 */
export async function savePartnerDiscount(partner: string, discountBps: number | null, adminId: string | null) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Under the partner's order lock, like the intake switch: an order being placed sees either the old or the new discount.
    await lockPartnerOrders(client, partner);
    // Clearing needs no row: a partner without one already falls back.
    if (discountBps != null) await client.query("INSERT INTO partner_settings(partner_code) VALUES($1) ON CONFLICT(partner_code) DO NOTHING", [partner]);
    const old = (await client.query<{ discount_bps: number | null }>("SELECT discount_bps FROM partner_settings WHERE partner_code=$1 FOR UPDATE", [partner])).rows[0];
    const changed = (old?.discount_bps ?? null) !== discountBps;
    if (changed) {
      await client.query("UPDATE partner_settings SET discount_bps=$2,updated_at=now(),updated_by=$3 WHERE partner_code=$1", [partner, discountBps, adminId]);
      await client.query("INSERT INTO partner_discount_changes(partner_code,old_discount_bps,new_discount_bps,changed_by) VALUES($1,$2,$3,$4)",
        [partner, old?.discount_bps ?? null, discountBps, adminId]);
    }
    await client.query("COMMIT");
    generation++;
    return { changed };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type PartnerDiscountChange = { oldBps: number | null; newBps: number | null; changedBy: string | null; changedAt: Date };

/** Each partner's last discount change, for the panel. */
export async function lastDiscountChanges(partners: string[], connection: Connection = db) {
  const { rows } = await connection.query<{ partner_code: string; old_bps: number | null; new_bps: number | null; changed_by: string | null; changed_at: Date }>(
    `SELECT DISTINCT ON (c.partner_code) c.partner_code,c.old_discount_bps AS old_bps,c.new_discount_bps AS new_bps,
      COALESCE(NULLIF(a.name,''),a.email) AS changed_by,c.changed_at
     FROM partner_discount_changes c LEFT JOIN accounts a ON a.id=c.changed_by WHERE c.partner_code=ANY($1::text[])
     ORDER BY c.partner_code,c.changed_at DESC,c.id DESC`, [partners]);
  return new Map<string, PartnerDiscountChange>(rows.map(row => [row.partner_code,
    { oldBps: row.old_bps, newBps: row.new_bps, changedBy: row.changed_by, changedAt: row.changed_at }]));
}
