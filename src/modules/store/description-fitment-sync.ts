import type { PoolClient } from "pg";

// Syncs product_model_fitments with a fresh derivation (#798) instead of rebuilding it: rows that disappeared are
// deleted, new ones inserted and only changed ones updated, so an unchanged row keeps its derived_at (the sitemap's
// max(derived_at) lastmod) and is not rewritten. derived_at moves when the model or its years change; a change of
// source_text alone updates the text but keeps derived_at, since the description edit already moves lastmod through
// supplier_items.changed_at. A deleted row leaves nothing for max(derived_at) to see, so the product's remaining rows
// get derived_at=now() instead; a product whose rows are all deleted simply loses its fitments (and that lastmod term).
// Kept items (#1370): the stored rows of the items in description_fitments_keep are left as they are, neither deleted
// nor updated (the derive keeps the enriched items its matching pass skips). description_fitments_next holds no row
// of a kept item. Every other stored row missing from description_fitments_next is deleted.
// Counts: inserted/updated are rows the upsert wrote, deleted the rows removed, kept the stored rows of kept items; a
// remaining row whose derived_at only moved because a sibling was deleted still counts as unchanged. The table then
// holds the next rows plus the kept ones.

export type DescriptionFitmentRow = { supplier_item_id: string; model_id: number; year_from: number | null; year_to: number | null; source_text: string };
export type DescriptionFitmentWriteResult = { inserted: number; updated: number; deleted: number; unchanged: number; kept: number };

/**
 * Loads the transaction's temp table description_fitments_keep, the items whose stored rows the diff and the write
 * leave untouched (#1370). `items` is a constant query returning their ids as one uuid column; without it the set is
 * empty and every stored row missing from description_fitments_next is deleted.
 */
export async function loadDescriptionFitmentsKeep(client: PoolClient, items?: string) {
  await client.query("DROP TABLE IF EXISTS pg_temp.description_fitments_keep");
  await client.query("CREATE TEMP TABLE description_fitments_keep(supplier_item_id uuid PRIMARY KEY) ON COMMIT DROP");
  if (items) await client.query(`INSERT INTO description_fitments_keep(supplier_item_id) ${items}`);
  // Temp tables are never autoanalyzed; the derive's item query, the diff and the write all join against this one.
  await client.query("ANALYZE description_fitments_keep");
}

/** Loads `rows` into the transaction's temp table description_fitments_next, the input of the diff and the write. */
export async function loadDescriptionFitmentsNext(client: PoolClient, rows: DescriptionFitmentRow[]) {
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
}

/** What writeDescriptionFitments would write for the loaded description_fitments_next and _keep, counted without writing. */
export async function diffDescriptionFitments(client: PoolClient): Promise<DescriptionFitmentWriteResult> {
  return (await client.query<DescriptionFitmentWriteResult>(`SELECT n.inserted,n.updated,g.deleted,n.unchanged,g.kept FROM
    (SELECT count(*) FILTER (WHERE o.supplier_item_id IS NULL)::int AS inserted,
     count(*) FILTER (WHERE o.supplier_item_id IS NOT NULL AND (o.year_from,o.year_to,o.source_text) IS DISTINCT FROM (n.year_from,n.year_to,n.source_text))::int AS updated,
     count(*) FILTER (WHERE o.supplier_item_id IS NOT NULL AND (o.year_from,o.year_to,o.source_text) IS NOT DISTINCT FROM (n.year_from,n.year_to,n.source_text))::int AS unchanged
     FROM description_fitments_next n LEFT JOIN product_model_fitments o ON o.supplier_item_id=n.supplier_item_id AND o.model_id=n.model_id) n,
    (SELECT count(*) FILTER (WHERE k.supplier_item_id IS NULL)::int AS deleted,count(*) FILTER (WHERE k.supplier_item_id IS NOT NULL)::int AS kept
     FROM product_model_fitments f LEFT JOIN description_fitments_keep k ON k.supplier_item_id=f.supplier_item_id
     WHERE NOT EXISTS(SELECT 1 FROM description_fitments_next x WHERE x.supplier_item_id=f.supplier_item_id AND x.model_id=f.model_id)) g`)).rows[0];
}

/** Replaces product_model_fitments with `rows` in the caller's transaction, writing only what changed; it keeps no item. */
export async function writeDescriptionFitments(client: PoolClient, rows: DescriptionFitmentRow[]): Promise<DescriptionFitmentWriteResult> {
  await loadDescriptionFitmentsKeep(client);
  await loadDescriptionFitmentsNext(client, rows);
  return applyDescriptionFitmentsNext(client, rows.length);
}

/** writeDescriptionFitments for an already loaded description_fitments_keep and description_fitments_next holding `count` rows. */
export async function applyDescriptionFitmentsNext(client: PoolClient, count: number): Promise<DescriptionFitmentWriteResult> {
  // The UPDATE sees the rows as they were before the DELETE; the EXISTS keeps the two row sets disjoint (remaining vs
  // deleted). A kept item loses no row, so none of its rows is bumped; `kept` is counted in the same snapshot.
  const { deleted, kept } = (await client.query<{ deleted: number; kept: number }>(`WITH d AS (
    DELETE FROM product_model_fitments f WHERE NOT EXISTS(SELECT 1 FROM description_fitments_next n
     WHERE n.supplier_item_id=f.supplier_item_id AND n.model_id=f.model_id)
     AND NOT EXISTS(SELECT 1 FROM description_fitments_keep k WHERE k.supplier_item_id=f.supplier_item_id) RETURNING f.supplier_item_id),
   bumped AS (UPDATE product_model_fitments f SET derived_at=now() WHERE f.supplier_item_id IN (SELECT supplier_item_id FROM d)
     AND EXISTS(SELECT 1 FROM description_fitments_next n WHERE n.supplier_item_id=f.supplier_item_id AND n.model_id=f.model_id) RETURNING 1)
   SELECT (SELECT count(*) FROM d)::int AS deleted,(SELECT count(*) FROM product_model_fitments f
     JOIN description_fitments_keep k ON k.supplier_item_id=f.supplier_item_id WHERE NOT EXISTS(SELECT 1 FROM description_fitments_next n
      WHERE n.supplier_item_id=f.supplier_item_id AND n.model_id=f.model_id))::int AS kept`)).rows[0];
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
  return { inserted: written.inserted, updated: written.updated, deleted, unchanged: count - written.inserted - written.updated, kept };
}
