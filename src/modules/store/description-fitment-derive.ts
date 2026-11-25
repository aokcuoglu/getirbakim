import type { PoolClient } from "pg";
import { createDescriptionMatcher, type DescriptionCatalogModel } from "./description-fitment";
import { applyDescriptionFitmentsNext, diffDescriptionFitments, loadDescriptionFitmentsKeep, loadDescriptionFitmentsNext,
  type DescriptionFitmentRow, type DescriptionFitmentWriteResult } from "./description-fitment-sync";

// The model-level fitment derivation from Dinamik's descriptions (#392), run by scripts/description-fitments.ts locally
// and as an AWS operations task (#562). It reads no server-only module: the task runs under plain `node --import tsx`.
// A product whose shared enrichment lists vehicles, or is complete, is skipped: TecDoc data always wins, and a complete
// enrichment without vehicles means the part is not vehicle-specific. Its stored rows are kept as they are (#1370):
// storefront_description_fits does not exclude enriched items and their engine fits do not cover every model the
// description named, so deleting the rows would drop the products from make and model pages, counts and sitemaps.

// The present Dinamik items with a usable enrichment: the matching pass reads none of them and the sync keeps their
// stored rows. Both read description_fitments_keep, loaded once from this query, so the two sets cannot drift apart.
const ENRICHED_DINAMIK_ITEMS = `SELECT s.id FROM supplier_items s WHERE s.supplier='dinamik' AND s.presence='present'
  AND EXISTS(SELECT 1 FROM product_enrichment_shared e WHERE e.supplier_item_id=s.id
   AND (e.status='complete' OR jsonb_array_length(COALESCE(e.payload->'vehicles','[]'::jsonb))>0))`;

/**
 * A derive leaving fewer than this share of the stored rows (derived plus kept rows) is refused unless allowShrink
 * (a partial Dinamik state).
 */
export const SHRINK_GUARD_RATIO = 0.7;
/**
 * A derivation deleting more than this share of the stored rows is refused unless allowShrink, even when inserts keep
 * the count level. Kept rows are not deletions.
 */
export const DELETE_GUARD_RATIO = 0.1;
/** Below this many stored rows the shrink and delete guards stay off: a fresh or tiny table may shrink freely. */
export const SHRINK_GUARD_MIN_EXISTING = 1000;
// Same key as before #562, so a local run and the AWS task never sync at once.
const LOCK_KEY = [20261106, 1];

export type DeriveOptions = { dryRun: boolean; allowShrink: boolean };
export type DeriveTopBrand = { brand: string; items: number; matched: number; pct: number };
export type DeriveResult = { status: "ok" | "busy" | "refused"; reason?: string; items: number; statuses: Record<string, number>; rows: number;
  existing: number; diff: DescriptionFitmentWriteResult | null; written: DescriptionFitmentWriteResult | null; top: DeriveTopBrand[] };

/**
 * Syncs product_model_fitments with a fresh derivation in its own transaction on `client`, keeping the rows of enriched
 * present Dinamik items. busy: another derive holds the lock; refused: a guard stopped it before anything was written.
 * `diff` is what the derivation would change once computed (also on a shrink- or delete-guard refusal, for review); a
 * dry run then rolls back with `written` = `diff`.
 */
export async function deriveDescriptionFitments(client: PoolClient, options: DeriveOptions): Promise<DeriveResult> {
  const result: DeriveResult = { status: "ok", items: 0, statuses: {}, rows: 0, existing: 0, diff: null, written: null, top: [] };
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
    await loadDescriptionFitmentsKeep(client, ENRICHED_DINAMIK_ITEMS);
    const items = (await client.query<{ id: string; brand: string; make: string; text: string }>(`SELECT s.id,
      COALESCE(NULLIF(s.product_data->>'uk',''),'') AS brand,COALESCE(s.product_data->>'kull1s','') AS make,
      COALESCE(NULLIF(s.product_data->>'ac',''),s.product_data->>'stokAdi','') AS text
      FROM supplier_items s WHERE s.supplier='dinamik' AND s.presence='present'
       AND COALESCE(NULLIF(s.product_data->>'ac',''),s.product_data->>'stokAdi','')<>''
       AND NOT EXISTS(SELECT 1 FROM description_fitments_keep k WHERE k.supplier_item_id=s.id)`)).rows;
    result.items = items.length;
    result.existing = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM product_model_fitments")).rows[0].count;
    const refuse = async (reason: string): Promise<DeriveResult> => {
      await client.query("ROLLBACK");
      return { ...result, status: "refused", reason };
    };
    if (catalog.length === 0) return refuse("the vehicle model catalog is empty");
    if (items.length === 0) return refuse("no present Dinamik item has a description to read");

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

    await loadDescriptionFitmentsNext(client, rows);
    const diff = result.diff = await diffDescriptionFitments(client);
    const guarded = !options.allowShrink && result.existing >= SHRINK_GUARD_MIN_EXISTING;
    // The table ends with the derived rows plus the kept ones: a derivation that is short only because most stored rows
    // belong to enriched items does not shrink it.
    const remaining = rows.length + diff.kept;
    if (guarded && remaining < result.existing * SHRINK_GUARD_RATIO) {
      return refuse(`the derive leaves ${remaining} rows (${rows.length} derived, ${diff.kept} kept), under ${SHRINK_GUARD_RATIO * 100}% of the ${result.existing} stored; review the diff and rerun with --allow-shrink if intended`);
    }
    if (guarded && diff.deleted > result.existing * DELETE_GUARD_RATIO) {
      return refuse(`the derivation deletes ${diff.deleted} of the ${result.existing} stored rows, over ${DELETE_GUARD_RATIO * 100}%; review the diff and rerun with --allow-shrink if intended`);
    }
    if (options.dryRun) {
      result.written = result.diff;
      await client.query("ROLLBACK");
    } else {
      result.written = await applyDescriptionFitmentsNext(client, rows.length);
      await client.query("COMMIT");
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
