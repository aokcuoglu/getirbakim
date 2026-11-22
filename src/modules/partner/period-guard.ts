import "server-only";
import type { PoolClient } from "pg";

/**
 * Partner period close guard (#1200): the partner's latest closed month (`YYYY-MM`) when any of the Istanbul calendar days
 * given falls in it or before it, else null. Closes are contiguous (periods.ts), so every month up to the latest closed one
 * is frozen; an earlier month without movements that was never closed counts as closed too.
 * Callers hold the partner's order lock (lockPartnerOrders), which closing and reopening a period take too, so the
 * answer stays true until their transaction ends. Kept apart from limits.ts so both limits.ts and collections.ts use it.
 */
export async function closedPeriod(client: Pick<PoolClient, "query">, partner: string, days: string[]): Promise<string | null> {
  const { rows } = await client.query<{ period: string }>(`SELECT to_char(max(period),'YYYY-MM') AS period FROM partner_period_closes
    WHERE partner_code=$1 HAVING max(period)>=(SELECT min(date_trunc('month',d)::date) FROM unnest($2::date[]) d)`, [partner, days]);
  return rows[0]?.period ?? null;
}
