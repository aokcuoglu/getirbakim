import type { Pool } from "pg";

/** `priceOnly` marks an unlinked Dinamik price-list-only code (price-only-queue.ts, #1075); its searches are recorded as such. */
export type PendingSupplier = { id: string; code: string; brand: string; oem: string; masterBrand: string | null; priceOnly?: boolean };

// Brand hit rates for the pending order (#380): spareto's from its own searches, Trodo's from its finished run items.
// While Trodo's host is blocked it collects nothing, so its rates are dropped (#390). A brand either source tried fewer
// than 5 times is left out and counts as 0.5 in the order. Searches of price-list-only codes (#1075) are left out: their
// brands are chosen by hand and would skew the storefront products' order.
export const brandRateSql = `SELECT COALESCE(jsonb_object_agg(brand,hit),'{}'::jsonb) AS rates FROM (SELECT b.supplier_brand AS brand,
  count(*) FILTER (WHERE a.outcome='found')::float/count(*) AS hit FROM enrichment_source_attempts a
  JOIN product_enrichment_jobs b ON b.supplier_item_id=a.supplier_item_id
  WHERE a.source='spareto' AND a.outcome IN ('found','not_found') AND a.queue IS DISTINCT FROM 'price_only' GROUP BY 1 HAVING count(*)>=5) r`;
export const trodoRateSql = `SELECT COALESCE(jsonb_object_agg(supplier_brand,hit),'{}'::jsonb) AS rates FROM (SELECT supplier_brand,
  count(*) FILTER (WHERE status IN ('complete','partial'))::float/count(*) AS hit FROM enrichment_run_items
  WHERE status IN ('complete','partial','review','not_found') GROUP BY 1 HAVING count(*)>=5) r
  WHERE NOT EXISTS(SELECT 1 FROM enrichment_source_hosts WHERE host='www.trodo.com' AND blocked)`;

// Products in an unfinished Trodo run are left to it.
const outsideActiveRun = `NOT EXISTS(SELECT 1 FROM enrichment_run_items i JOIN enrichment_runs r ON r.id=i.run_id
  WHERE i.product_id=j.product_id AND r.status IN ('prepared','running','blocked','stopped'))`;

/**
 * Pending supplier rows in the Trodo catalog pass's tiers (in stock, other storefront items, items no longer offered);
 * within a tier spareto's hit rate times Trodo's miss rate, then the reverse hash order. Ids only, read from the
 * materialized enrichment_product_states: the catalog view rebuilt per pending row took over a minute for 200 rows (#921).
 * The rates travel as jsonb parameters; a join would walk the rate list once per pending row.
 */
export const pendingOrderSql = `SELECT j.supplier_item_id AS id
 FROM enrichment_product_states j LEFT JOIN commerce_supplier_items c ON c.id=j.supplier_item_id
 WHERE j.status='pending' AND j.supplier_brand<>'' AND j.supplier_item_id IS NOT NULL AND ${outsideActiveRun}
 ORDER BY CASE WHEN c.id IS NULL THEN 3 WHEN COALESCE((c.stock_data->>'stok')::numeric,0)>0 OR COALESCE((c.stock_data->>'sFarkliDepo')::numeric,0)>0 THEN 1 ELSE 2 END,
  COALESCE(($2::jsonb->>j.supplier_brand)::float,0.5)*(1-COALESCE(($3::jsonb->>j.supplier_brand)::float,0.5)) DESC,md5(j.product_id::text) DESC
 LIMIT $1`;

/**
 * The supplier details of one chunk of ordered ids, in that order; an id no longer pending or now in a Trodo run drops
 * out. The item's own job must still be open, the same check the write makes (by primary key), so a states row left
 * stale by a skipped sync does not cost a search whose result would be discarded.
 */
export const pendingChunkSql = `SELECT j.supplier_item_id AS id,s.code,
 COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'') AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 (SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data)) AS "masterBrand"
 FROM unnest($1::uuid[]) WITH ORDINALITY u(id,ord) JOIN enrichment_product_states j ON j.supplier_item_id=u.id JOIN supplier_items s ON s.id=u.id
 WHERE j.status='pending' AND j.supplier_brand<>'' AND ${outsideActiveRun}
  AND EXISTS(SELECT 1 FROM product_enrichment_jobs pj WHERE pj.supplier_item_id=u.id AND pj.status IN ('pending','not_found','review'))
 ORDER BY u.ord`;

const sync = (pool: Pool) => pool.query("SELECT enrichment_product_states_sync()");

/**
 * Pending suppliers to search, `limit` at most, skipping `tried` (ids searched before; every yielded id is added).
 * The order is read once per `reorderEvery` products, so the brand rates follow the searches; the details are read
 * in chunks of `chunk` ids just before they are searched, and the states table is synced before each read, so an item
 * another source finished meanwhile is not searched again. No query carries the tried list.
 * enrichment_product_states_sync() returns without syncing while another session holds its lock (refresh_product_matches,
 * db:setup), so a read may see states a few seconds old; the chunk's job check and the write's own re-check of the job
 * keep such an item from being stored twice.
 */
export async function* pendingSuppliers(pool: Pool, tried: Set<string>, limit: number,
  { chunk = 200, reorderEvery = 1000 }: { chunk?: number; reorderEvery?: number } = {}): AsyncGenerator<PendingSupplier> {
  let left = limit;
  while (left > 0) {
    await sync(pool);
    const rates = (await pool.query<{ rates: unknown }>(brandRateSql)).rows[0].rates;
    const trodoRates = (await pool.query<{ rates: unknown }>(trodoRateSql)).rows[0].rates;
    const take = Math.min(left, reorderEvery);
    const ordered = (await pool.query<{ id: string }>(pendingOrderSql, [take + tried.size, JSON.stringify(rates), JSON.stringify(trodoRates)])).rows
      .map((row) => row.id).filter((id) => !tried.has(id)).slice(0, take);
    if (!ordered.length) return;
    for (let at = 0; at < ordered.length && left > 0;) {
      await sync(pool);
      const ids = ordered.slice(at, at + Math.min(chunk, left));
      at += ids.length;
      for (const id of ids) tried.add(id);
      const rows = (await pool.query<PendingSupplier>(pendingChunkSql, [ids])).rows;
      for (const row of rows) { left--; yield row; }
    }
  }
}
