import "server-only";
import type { PoolClient } from "pg";

/**
 * Partner period close guard (#1200): the first closed month (`YYYY-MM`) among the Istanbul calendar days given, or null.
 * Callers hold the partner's order lock (lockPartnerOrders), which closing and reopening a period take too, so the
 * answer stays true until their transaction ends. Kept apart from limits.ts so both limits.ts and collections.ts use it.
 */
export async function closedPeriod(client: Pick<PoolClient, "query">, partner: string, days: string[]): Promise<string | null> {
  const { rows } = await client.query<{ period: string }>(`SELECT to_char(period,'YYYY-MM') AS period FROM partner_period_closes
    WHERE partner_code=$1 AND period=ANY(SELECT date_trunc('month',d)::date FROM unnest($2::date[]) d) ORDER BY 1 LIMIT 1`, [partner, days]);
  return rows[0]?.period ?? null;
}
