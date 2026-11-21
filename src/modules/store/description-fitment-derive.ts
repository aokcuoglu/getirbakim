import type { PoolClient } from "pg";
import { createDescriptionMatcher, type DescriptionCatalogModel } from "./description-fitment";
import { diffDescriptionFitments, loadDescriptionFitmentsNext, writeDescriptionFitments, type DescriptionFitmentRow,
  type DescriptionFitmentWriteResult } from "./description-fitment-sync";

// The model-level fitment derivation from Dinamik's descriptions (#392), run by scripts/description-fitments.ts locally
// and as an AWS operations task (#562). It reads no server-only module: the task runs under plain `node --import tsx`.
// A product whose shared enrichment lists vehicles, or is complete, is skipped: TecDoc data always wins, and a complete
// enrichment without vehicles means the part is not vehicle-specific.

/** A derivation shorter than this share of the stored rows is refused unless allowShrink (a partial Dinamik state). */
export const SHRINK_GUARD_RATIO = 0.7;
/** Below this many stored rows the shrink guard stays off: a fresh or tiny table may shrink freely. */
export const SHRINK_GUARD_MIN_EXISTING = 1000;
// Same key as before #562, so a local run and the AWS task never sync at once.
const LOCK_KEY = [20261106, 1];

export type DeriveOptions = { dryRun: boolean; allowShrink: boolean };
export type DeriveTopBrand = { brand: string; items: number; matched: number; pct: number };
export type DeriveResult = { status: "ok" | "busy" | "refused"; reason?: string; items: number; statuses: Record<string, number>; rows: number;
  existing: number; written: DescriptionFitmentWriteResult | null; top: DeriveTopBrand[] };

/**
 * Syncs product_model_fitments with a fresh derivation in its own transaction on `client`. busy: another derive holds
 * the lock; refused: a guard stopped it before anything was written. A dry run loads and diffs, then rolls back:
 * `written` is then what a real run would write.
 */
export async function deriveDescriptionFitments(client: PoolClient, options: DeriveOptions): Promise<DeriveResult> {
  const result: DeriveResult = { status: "ok", items: 0, statuses: {}, rows: 0, existing: 0, written: null, top: [] };
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='15min'");
    if (!(await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock($1,$2) AS locked", LOCK_KEY)).rows[0].locked) {
      await client.query("ROLLBACK");
      return { ...result, status: "busy", reason: "another description fitment derive holds the lock" };
    }
    const catalog = (await client.query<DescriptionCatalogModel>(`SELECT m.id,b.name AS brand,m.name,
      extract(year FROM m.date_from)::int AS "from",extract(year FROM m.date_to)::int AS "to"
      FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id`)).rows;
    const items = (await client.query<{ id: string; brand: string; make: string; text: string }>(`SELECT s.id,
      COALESCE(NULLIF(s.product_data->>'uk',''),'') AS brand,COALESCE(s.product_data->>'kull1s','') AS make,
      COALESCE(NULLIF(s.product_data->>'ac',''),s.product_data->>'stokAdi','') AS text
      FROM supplier_items s WHERE s.supplier='dinamik' AND s.presence='present'
       AND COALESCE(NULLIF(s.product_data->>'ac',''),s.product_data->>'stokAdi','')<>''
       AND NOT EXISTS(SELECT 1 FROM product_enrichment_shared e WHERE e.supplier_item_id=s.id
        AND (e.status='complete' OR jsonb_array_length(COALESCE(e.payload->'vehicles','[]'::jsonb))>0))`)).rows;
    result.items = items.length;
    result.existing = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM product_model_fitments")).rows[0].count;

    const match = createDescriptionMatcher(catalog);
    const rows: DescriptionFitmentRow[] = [];
    const brands = new Map<string, { items: number; matched: number }>();
    for (const item of items) {
      const fitment = match(item.make, item.text);
      result.statuses[fitment.status] = (result.statuses[fitment.status] ?? 0) + 1;
      const brand = brands.get(item.brand) ?? { items: 0, matched: 0 };
      brand.items++;
      if (fitment.status === "matched") {
        brand.matched++;
        for (const model of fitment.models) rows.push({ supplier_item_id: item.id, model_id: model.id, year_from: model.yearFrom, year_to: model.yearTo, source_text: item.text });
      }
      brands.set(item.brand, brand);
    }
    result.rows = rows.length;
    result.top = [...brands].filter(([, b]) => b.matched).sort((a, b) => b[1].matched - a[1].matched).slice(0, 25)
      .map(([brand, b]) => ({ brand, items: b.items, matched: b.matched, pct: Math.round(100 * b.matched / b.items) }));

    const reason = catalog.length === 0 ? "the vehicle model catalog is empty"
      : items.length === 0 ? "no present Dinamik item has a description to read"
        : !options.allowShrink && result.existing >= SHRINK_GUARD_MIN_EXISTING && rows.length < result.existing * SHRINK_GUARD_RATIO
          ? `the derivation has ${rows.length} rows, under ${SHRINK_GUARD_RATIO * 100}% of the ${result.existing} stored; rerun with --allow-shrink if intended`
          : null;
    if (reason) {
      await client.query("ROLLBACK");
      return { ...result, status: "refused", reason };
    }
    if (options.dryRun) {
      await loadDescriptionFitmentsNext(client, rows);
      result.written = await diffDescriptionFitments(client);
      await client.query("ROLLBACK");
    } else {
      result.written = await writeDescriptionFitments(client, rows);
      await client.query("COMMIT");
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
