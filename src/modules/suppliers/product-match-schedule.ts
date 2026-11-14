import type { ClientBase } from "pg";
import { z } from "zod";

type Query = Pick<ClientBase, "query">;

/** Hours between automatic product-match refreshes from the supplier scheduler; 0 turns them off. */
export const productMatchIntervalHours = (value = process.env.PRODUCT_MATCH_INTERVAL_HOURS) =>
  z.coerce.number().min(0).max(168).parse(value || 6);

// Due when a supplier row changed since the last refresh started (a change during that run is not in it) and the
// last refresh finished longer ago than the interval. No refresh yet: due as soon as anything changed.
const dueSql = `SELECT EXISTS (SELECT 1 FROM supplier_item_changes
    WHERE changed_at>COALESCE((SELECT max(started_at) FROM product_match_runs),'-infinity'))
  AND COALESCE((SELECT max(completed_at) FROM product_match_runs)<now()-$1*interval '1 hour',true) AS due`;

export type ProductMatchRefresh =
  | { productMatch: "off" | "not_due" }
  | { productMatch: "refreshed"; seconds: number; pendingBrands: number; newBrands: number; brandSuggestions: number }
  | { productMatch: "failed"; code?: string };

/**
 * Rebuilds the master catalog (refresh_product_matches) after supplier changes, at most once per interval. New
 * supplier brand labels are only placed, and their products only listed, by that refresh. A failed refresh keeps the
 * previous results and is reported, not thrown: the supplier data it would read is already saved.
 */
export async function refreshProductMatchesIfDue(client: Query, hours = productMatchIntervalHours()): Promise<ProductMatchRefresh> {
  if (hours === 0) return { productMatch: "off" };
  try {
    if (!(await client.query<{ due: boolean }>(dueSql, [hours])).rows[0]?.due) return { productMatch: "not_due" };
    const started = Date.now();
    const stats = (await client.query<{ stats: Record<string, number> }>("SELECT refresh_product_matches() AS stats")).rows[0].stats;
    return { productMatch: "refreshed", seconds: Math.round((Date.now() - started) / 1000), pendingBrands: stats.pending_brands ?? 0,
      newBrands: stats.new_brands ?? 0, brandSuggestions: stats.brand_merge_suggestions ?? 0 };
  } catch (error) {
    return { productMatch: "failed", code: (error as { code?: string }).code };
  }
}
