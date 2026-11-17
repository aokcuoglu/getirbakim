import "server-only";
import type { Pool } from "pg";
import type { ProductOverrideChange } from "./product-override-store";
import { fitmentBatchSampleSize } from "./product-fitment-fields";

/** History lines per page of the product page's "Geçmiş" tab (#816). */
export const productHistoryPageSize = 50;

/**
 * One line of a product's history (#816): a single change, or the rows of one bulk fitment change (a bulk add, a copy,
 * the undo of one; product_override_changes.batch_id) as one line. A line of a batch carries the latest row's id and
 * time; its old/new values are those of its rows only when it has one.
 */
export type ProductHistoryEntry = ProductOverrideChange & {
  batch_id: string | null;
  /** Type rows of the line (a copy's summary row not counted); 1 for a single change. */
  count: number;
  /** A copy's summary text (its fitment_copied row). */
  summary: string | null;
  /** The first type ids of the line, for "A, B, C ve N tip daha". */
  sample: string[];
  /** The batch's types still added to the product: what "Geri al" would take back (#817). */
  undoable: number;
};

export type ProductHistory = {
  entries: ProductHistoryEntry[];
  total: number; page: number; pages: number;
  /** The batch whose rows are listed one by one (`?toplu=`), or null for the grouped history. */
  batch: string | null;
};

const pageOf = (requested: number, total: number) => {
  const pages = Math.max(1, Math.ceil(total / productHistoryPageSize));
  const page = Math.min(Math.max(1, Number.isInteger(requested) ? requested : 1), pages);
  return { page, pages, offset: (page - 1) * productHistoryPageSize };
};

// A line per batch, a line per change without one; the grouped columns of every line.
const groupedSql = `SELECT max(c.id)::text AS id,c.batch_id::text AS batch_id,max(c.changed_at) AS changed_at,
   CASE WHEN bool_or(c.field='fitment_copied') THEN 'fitment_copied' ELSE min(c.field) END AS field,
   CASE WHEN count(*)=1 THEN min(c.old_value) END AS old_value,CASE WHEN count(*)=1 THEN min(c.new_value) END AS new_value,
   min(a.name) AS changed_by,min(c.reason) AS reason,
   count(*) FILTER (WHERE c.field<>'fitment_copied')::int AS count,
   max(c.new_value) FILTER (WHERE c.field='fitment_copied') AS summary,
   COALESCE((array_agg(COALESCE(c.new_value,c.old_value) ORDER BY c.id) FILTER (WHERE c.field<>'fitment_copied'))[1:${fitmentBatchSampleSize}],'{}') AS sample
  FROM product_override_changes c LEFT JOIN accounts a ON a.id=c.changed_by WHERE c.product_id=$1
  GROUP BY c.batch_id,CASE WHEN c.batch_id IS NULL THEN c.id END`;

/**
 * A product's history, newest first, productHistoryPageSize lines a page (#816). Without `batch` the rows of a bulk
 * fitment change are one line; with it only that batch's rows are listed, in the order they were written. A page past
 * the end shows the last one.
 */
export async function loadProductHistory(database: Pick<Pool, "query">, productId: string, options: { page?: number; batch?: string | null } = {}): Promise<ProductHistory> {
  const batch = options.batch ?? null;
  if (batch) {
    const total = (await database.query<{ n: number }>("SELECT count(*)::int AS n FROM product_override_changes WHERE product_id=$1 AND batch_id=$2",
      [productId, batch])).rows[0].n;
    const { page, pages, offset } = pageOf(options.page ?? 1, total);
    const entries = (await database.query<ProductHistoryEntry>(`SELECT c.id::text,c.batch_id::text AS batch_id,c.field,c.old_value,c.new_value,c.changed_at,
       a.name AS changed_by,c.reason,1 AS count,NULL AS summary,'{}'::text[] AS sample,0 AS undoable
      FROM product_override_changes c LEFT JOIN accounts a ON a.id=c.changed_by WHERE c.product_id=$1 AND c.batch_id=$2
      ORDER BY c.id LIMIT ${productHistoryPageSize} OFFSET $3`, [productId, batch, offset])).rows;
    return { entries, total, page, pages, batch };
  }
  const total = (await database.query<{ n: number }>(`SELECT count(DISTINCT COALESCE(batch_id::text,'c'||id))::int AS n
    FROM product_override_changes WHERE product_id=$1`, [productId])).rows[0].n;
  const { page, pages, offset } = pageOf(options.page ?? 1, total);
  const entries = (await database.query<ProductHistoryEntry>(`WITH g AS (${groupedSql})
    SELECT g.*,(SELECT count(*)::int FROM product_override_fitments f WHERE f.product_id=$1 AND f.batch_id=g.batch_id::uuid AND f.mode='add') AS undoable
    FROM g ORDER BY g.changed_at DESC,g.id::bigint DESC LIMIT ${productHistoryPageSize} OFFSET $2`, [productId, offset])).rows;
  return { entries, total, page, pages, batch: null };
}
