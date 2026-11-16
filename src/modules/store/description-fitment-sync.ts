import type { PoolClient } from "pg";

// Syncs product_model_fitments with a fresh derivation (#798) instead of rebuilding it: rows that disappeared are
// deleted, new ones inserted and only changed ones updated, so an unchanged row keeps its derived_at (the sitemap's
// max(derived_at) lastmod) and is not rewritten. derived_at moves when the model or its years change; a change of
// source_text alone updates the text but keeps derived_at, since the description edit already moves lastmod through
// supplier_items.changed_at. A deleted row leaves nothing for max(derived_at) to see, so the product's remaining rows
// get derived_at=now() instead; a product whose rows are all deleted simply loses its fitments (and that lastmod term).
// Counts: inserted/updated are rows the upsert wrote, deleted the rows removed; a remaining row whose derived_at only
// moved because a sibling was deleted still counts as unchanged.

export type DescriptionFitmentRow = { supplier_item_id: string; model_id: number; year_from: number | null; year_to: number | null; source_text: string };
export type DescriptionFitmentWriteResult = { inserted: number; updated: number; deleted: number; unchanged: number };

/** Replaces product_model_fitments with `rows` in the caller's transaction, writing only what changed. */
export async function writeDescriptionFitments(client: PoolClient, rows: DescriptionFitmentRow[]): Promise<DescriptionFitmentWriteResult> {
  await client.query("DROP TABLE IF EXISTS pg_temp.description_fitments_next");
  await client.query(`CREATE TEMP TABLE description_fitments_next(supplier_item_id uuid NOT NULL,model_id integer NOT NULL,
    year_from integer,year_to integer,source_text text NOT NULL) ON COMMIT DROP`);
  for (let at = 0; at < rows.length; at += 5000) await client.query(`INSERT INTO description_fitments_next(supplier_item_id,model_id,year_from,year_to,source_text)
    SELECT supplier_item_id,model_id,year_from,year_to,source_text FROM jsonb_to_recordset($1::jsonb)
    AS r(supplier_item_id uuid,model_id integer,year_from integer,year_to integer,source_text text)`, [JSON.stringify(rows.slice(at, at + 5000))]);
  // Duplicate-input guard (one row per key keeps `unchanged` = rows.length minus written correct); the bump UPDATE also uses it.
  await client.query("CREATE UNIQUE INDEX ON description_fitments_next(supplier_item_id,model_id)");
  // Temp tables are never autoanalyzed; without statistics the joins below fall back to nested loops over every fitment.
  await client.query("ANALYZE description_fitments_next");
  // The UPDATE sees the rows as they were before the DELETE; the EXISTS keeps the two row sets disjoint (kept vs deleted).
  const { deleted } = (await client.query<{ deleted: number }>(`WITH d AS (
    DELETE FROM product_model_fitments f WHERE NOT EXISTS(SELECT 1 FROM description_fitments_next n
     WHERE n.supplier_item_id=f.supplier_item_id AND n.model_id=f.model_id) RETURNING f.supplier_item_id),
   bumped AS (UPDATE product_model_fitments f SET derived_at=now() WHERE f.supplier_item_id IN (SELECT supplier_item_id FROM d)
     AND EXISTS(SELECT 1 FROM description_fitments_next n WHERE n.supplier_item_id=f.supplier_item_id AND n.model_id=f.model_id) RETURNING 1)
   SELECT (SELECT count(*) FROM d)::int AS deleted`)).rows[0];
  // The LEFT JOIN keeps unchanged rows out of the INSERT: ON CONFLICT DO UPDATE ... WHERE false would still lock them.
  const written = (await client.query<{ inserted: number; updated: number }>(`WITH w AS (
    INSERT INTO product_model_fitments AS f(supplier_item_id,model_id,year_from,year_to,source_text)
    SELECT n.supplier_item_id,n.model_id,n.year_from,n.year_to,n.source_text FROM description_fitments_next n
     LEFT JOIN product_model_fitments o ON o.supplier_item_id=n.supplier_item_id AND o.model_id=n.model_id
     WHERE o.supplier_item_id IS NULL OR (o.year_from,o.year_to,o.source_text) IS DISTINCT FROM (n.year_from,n.year_to,n.source_text)
    ON CONFLICT (supplier_item_id,model_id) DO UPDATE SET year_from=EXCLUDED.year_from,year_to=EXCLUDED.year_to,source_text=EXCLUDED.source_text,
     derived_at=CASE WHEN (f.year_from,f.year_to) IS DISTINCT FROM (EXCLUDED.year_from,EXCLUDED.year_to) THEN now() ELSE f.derived_at END
     WHERE (f.year_from,f.year_to,f.source_text) IS DISTINCT FROM (EXCLUDED.year_from,EXCLUDED.year_to,EXCLUDED.source_text)
    RETURNING (xmax=0) AS inserted)
    SELECT count(*) FILTER (WHERE inserted)::int AS inserted,count(*) FILTER (WHERE NOT inserted)::int AS updated FROM w`)).rows[0];
  return { inserted: written.inserted, updated: written.updated, deleted, unchanged: rows.length - written.inserted - written.updated };
}
