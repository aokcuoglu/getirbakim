import type { Pool, PoolClient } from "pg";
import type { PendingSupplier } from "./pending-queue";

// Dinamik price-list-only codes (#1075): rows of Dinamik's price list without a stock-list row (stock_data IS NULL) that
// no master product links. They are never saleable, so the storefront's pending queue never reaches them; once enriched
// they can become "Gelince haber ver" cards (storefront_price_only_items, #1068). Their legacy enrichment jobs are the
// queue's registry: a job is searched only while its code and brand equal the live row (enqueuePriceOnlySources aligns
// them), and only for brands enabled in enrichment_price_only_brands (spareto) or matched to an archived article
// (parts2world). Both workers give them a share of their pending pass (priceOnlyShare, default 0: off).

const brandSql = "COALESCE(NULLIF(s.product_data->>'uk',''),supplier_item_brand(s.supplier,s.product_data),'')";
const masterBrandSql = `(SELECT b.name FROM supplier_brands sb JOIN brands b ON b.id=sb.brand_id
  WHERE sb.supplier=s.supplier AND sb.label=supplier_item_brand(s.supplier,s.product_data))`;
/** A present, never-saleable Dinamik row linked to no master product (supplier_items s). */
const priceOnlySourceSql = `s.supplier='dinamik' AND s.stock_data IS NULL AND s.presence='present' AND NOT s.conflicting
 AND NOT EXISTS(SELECT 1 FROM product_sources ps WHERE ps.supplier_item_id=s.id)`;

/**
 * A price-only row ready to search (supplier_items s, its product_enrichment_jobs j): the job is pending and carries the
 * row's own code and brand, and no master product has the row's brand and part number (that product's other rows are
 * enriched through the storefront queue and shared with it).
 */
export const priceOnlyRowSql = `${priceOnlySourceSql}
 AND j.status='pending' AND j.supplier_code=s.code AND j.supplier_brand<>'' AND j.supplier_brand=${brandSql}
 AND NOT EXISTS(SELECT 1 FROM products p WHERE p.brand=supplier_item_brand_key(s.supplier,s.product_data)
  AND p.part_number=supplier_item_part_number(s.supplier,s.code,s.product_data) AND p.merged_into IS NULL)`;

/** No spareto answer yet: a found or not-found search is final for spareto (an error or a block is searched again). */
const sparetoUnanswered = `NOT EXISTS(SELECT 1 FROM enrichment_source_attempts a WHERE a.supplier_item_id=s.id
  AND a.source='spareto' AND a.outcome IN ('found','not_found'))`;

/**
 * spareto's price-only order: ids of the enabled brands' ($2 labels, reached through supplier_items_brand_label_idx)
 * rows spareto has not answered, rows parts2world can reach through an archived article last (it takes them), then the
 * reverse hash order. $1 is the limit.
 */
export const priceOnlyOrderSql = `SELECT s.id FROM supplier_items s JOIN product_enrichment_jobs j ON j.supplier_item_id=s.id
 WHERE supplier_item_brand(s.supplier,s.product_data)=ANY($2::text[]) AND ${priceOnlyRowSql} AND ${sparetoUnanswered}
 ORDER BY EXISTS(SELECT 1 FROM parts2world_job_articles m WHERE m.supplier_item_id=s.id),md5(s.id::text) DESC
 LIMIT $1`;

/** The supplier details of one chunk of ordered ids, in that order; a row no longer ready (stock row, job finished) drops out. */
export const priceOnlyChunkSql = `SELECT s.id,s.code,${brandSql} AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 ${masterBrandSql} AS "masterBrand",true AS "priceOnly"
 FROM unnest($1::uuid[]) WITH ORDINALITY u(id,ord) JOIN supplier_items s ON s.id=u.id JOIN product_enrichment_jobs j ON j.supplier_item_id=u.id
 WHERE ${priceOnlyRowSql}
 ORDER BY u.ord`;

/**
 * parts2world's price-only queue: every brand's ready rows matched to an archived article, with the columns of the
 * pending queue's rows (scripts/parts2world-enrichment.ts). The proxy worker walks it from the other end (`descending`).
 */
export const priceOnlyArticleQueueSql = (descending: boolean) => `SELECT s.id,s.code,${brandSql} AS brand,COALESCE(s.product_data->>'oe','') AS oem,
 COALESCE(s.product_data->>'kull1s','') AS make,${masterBrandSql} AS "masterBrand",
 a.article_id::text AS "articleId",a.link_id::text AS "linkId",a.vehicle_type_id AS "vehicleTypeId",m.oem_reference AS "oemReference",true AS "priceOnly"
 FROM parts2world_job_articles m JOIN parts2world_articles a USING(brand_key,part_key)
 JOIN product_enrichment_jobs j ON j.supplier_item_id=m.supplier_item_id JOIN supplier_items s ON s.id=m.supplier_item_id
 WHERE ${priceOnlyRowSql}
 ORDER BY md5(s.id::text)${descending ? " DESC" : ""}`;

export const enabledBrandsSql = "SELECT label FROM enrichment_price_only_brands ORDER BY label";

export type PriceOnlyStats = { label: string; total: number; searched: number; found: number; enriched: number; published: number; remaining: number };
const attempted = (outcome: string) => `EXISTS(SELECT 1 FROM enrichment_source_attempts a WHERE a.supplier_item_id=s.id AND a.queue='price_only' AND ${outcome})`;
const statsColumns = (remaining: string) => `count(s.id)::int AS total,
 count(s.id) FILTER (WHERE ${attempted("a.outcome<>'blocked'")})::int AS searched,
 count(s.id) FILTER (WHERE ${attempted("a.outcome='found'")})::int AS found,
 count(s.id) FILTER (WHERE j.status IN ('complete','partial'))::int AS enriched,
 count(q.supplier_item_id)::int AS published,
 count(s.id) FILTER (WHERE ${remaining})::int AS remaining`;
/**
 * Progress per enabled brand: its price-only rows (total), those searched or found under the price_only queue by any
 * source, enriched (job complete or partial), listed as cards (storefront_price_only_items) and still in spareto's queue.
 */
export const priceOnlyStatsSql = `SELECT b.label,${statsColumns(`${priceOnlyRowSql} AND ${sparetoUnanswered}`)}
 FROM enrichment_price_only_brands b
 LEFT JOIN supplier_items s ON supplier_item_brand(s.supplier,s.product_data)=b.label AND ${priceOnlySourceSql}
 LEFT JOIN product_enrichment_jobs j ON j.supplier_item_id=s.id
 LEFT JOIN storefront_price_only_items q ON q.supplier_item_id=s.id
 GROUP BY b.label ORDER BY b.label`;
/** The same figures for the other brands' rows parts2world reaches; remaining counts rows it has not answered. */
export const priceOnlyOtherBrandsStatsSql = `SELECT 'parts2world, other brands' AS label,${statsColumns(`${priceOnlyRowSql}
  AND NOT EXISTS(SELECT 1 FROM enrichment_source_attempts a WHERE a.supplier_item_id=s.id AND a.source='parts2world' AND a.outcome IN ('found','not_found'))`)}
 FROM parts2world_job_articles m JOIN supplier_items s ON s.id=m.supplier_item_id
 LEFT JOIN product_enrichment_jobs j ON j.supplier_item_id=s.id
 LEFT JOIN storefront_price_only_items q ON q.supplier_item_id=s.id
 WHERE ${priceOnlySourceSql} AND supplier_item_brand(s.supplier,s.product_data) NOT IN (SELECT label FROM enrichment_price_only_brands)`;

/**
 * Price-only rows of the enabled brands for spareto, `limit` at most, skipping `tried` (every yielded id is added). Like
 * pendingSuppliers, the order is read once per `reorderEvery` products and the details in chunks of `chunk` ids just
 * before they are searched; no query carries the tried list.
 */
export async function* priceOnlySuppliers(pool: Pool, tried: Set<string>, limit: number,
  { chunk = 200, reorderEvery = 1000 }: { chunk?: number; reorderEvery?: number } = {}): AsyncGenerator<PendingSupplier> {
  let left = limit;
  while (left > 0) {
    const labels = (await pool.query<{ label: string }>(enabledBrandsSql)).rows.map((row) => row.label);
    if (!labels.length) return;
    const take = Math.min(left, reorderEvery);
    const ordered = (await pool.query<{ id: string }>(priceOnlyOrderSql, [take + tried.size, labels])).rows
      .map((row) => row.id).filter((id) => !tried.has(id)).slice(0, take);
    if (!ordered.length) return;
    for (let at = 0; at < ordered.length && left > 0;) {
      const ids = ordered.slice(at, at + Math.min(chunk, left));
      at += ids.length;
      for (const id of ids) tried.add(id);
      for (const row of (await pool.query<PendingSupplier>(priceOnlyChunkSql, [ids])).rows) { left--; yield row; }
    }
  }
}

// Float products such as 0.1*3 land just below the whole number they stand for.
const due = (fromSecondary: number, emitted: number, share: number) => fromSecondary + 1 <= share * (emitted + 1) + 1e-9;

/**
 * Merges two ordered lists so that `share` of the result comes from `secondary`, the primary list first: at 0.25 every
 * fourth item. When one list runs out the other continues; a share of 0 or less returns `primary` alone.
 */
export function interleaveByShare<T>(primary: T[], secondary: T[], share: number): T[] {
  if (!(share > 0)) return [...primary];
  const out: T[] = [];
  let p = 0, s = 0;
  while (p < primary.length || s < secondary.length) {
    if (s < secondary.length && (p >= primary.length || due(s, out.length, share))) out.push(secondary[s++]);
    else out.push(primary[p++]);
  }
  return out;
}

/** interleaveByShare over two lazy streams: an item is pulled from a stream only when it is emitted. */
export async function* interleaveStreams<T>(primary: AsyncIterable<T>, secondary: AsyncIterable<T>, share: number): AsyncGenerator<T> {
  if (!(share > 0)) { yield* primary; return; }
  const a = primary[Symbol.asyncIterator](), b = secondary[Symbol.asyncIterator]();
  let aDone = false, bDone = false, emitted = 0, fromSecondary = 0;
  try {
    while (!aDone || !bDone) {
      const takeSecondary = !bDone && (aDone || due(fromSecondary, emitted, share));
      const next = await (takeSecondary ? b : a).next();
      if (next.done) { if (takeSecondary) bDone = true; else aDone = true; continue; }
      emitted++;
      if (takeSecondary) fromSecondary++;
      yield next.value;
    }
  } finally {
    await a.return?.();
    await b.return?.();
  }
}

/** The pending pass's price-only share: `--price-only-share` or ENRICHMENT_PRICE_ONLY_SHARE, clamped to 0..1, default 0. */
export function priceOnlyShare(flag?: string, env = process.env.ENRICHMENT_PRICE_ONLY_SHARE) {
  const raw = (flag ?? env ?? "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw Error(`price-only share must be a number between 0 and 1, got "${raw}"`);
  return Math.min(1, Math.max(0, value));
}

const enqueueChunk = 10_000;
/**
 * Gives every present, unlinked price-only Dinamik row with a brand a job carrying its live code, brand and OEM: a
 * missing job is inserted, an open one (pending, not_found, review) whose identity differs (the legacy jobs carry an
 * empty brand) is realigned and reopened. A finished job (complete, partial…) is never touched: reopening it would hide
 * its enrichment and log a tombstone the AWS import does not apply.
 * Every brand, not only the enabled ones: parts2world's match reads the jobs. The candidates are read once, then written
 * in chunks that re-check the live row, so a run of hundreds of thousands of rows holds no long transaction; a second
 * run writes nothing. Returns the number of jobs written.
 */
export async function enqueuePriceOnlySources(pool: Pool | PoolClient) {
  const ids = (await pool.query<{ id: string }>(`SELECT s.id FROM supplier_items s LEFT JOIN product_enrichment_jobs j ON j.supplier_item_id=s.id
    WHERE ${priceOnlySourceSql} AND ${brandSql}<>''
     AND (j.supplier_item_id IS NULL OR j.status IN ('pending','not_found','review') AND (j.supplier_code<>s.code OR j.supplier_brand<>${brandSql} OR j.oem<>COALESCE(s.product_data->>'oe','')))
    ORDER BY s.id`)).rows.map((row) => row.id);
  let written = 0;
  for (let at = 0; at < ids.length; at += enqueueChunk) {
    written += (await pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,oem)
      SELECT s.id,s.code,${brandSql},COALESCE(s.product_data->>'oe','') FROM unnest($1::uuid[]) u(id) JOIN supplier_items s ON s.id=u.id
      WHERE ${priceOnlySourceSql} AND ${brandSql}<>''
      ON CONFLICT(supplier_item_id) DO UPDATE SET supplier_code=EXCLUDED.supplier_code,supplier_brand=EXCLUDED.supplier_brand,
        oem=EXCLUDED.oem,status='pending',last_error=NULL,updated_at=now()
      WHERE product_enrichment_jobs.status IN ('pending','not_found','review')
       AND (product_enrichment_jobs.supplier_code<>EXCLUDED.supplier_code
        OR product_enrichment_jobs.supplier_brand<>EXCLUDED.supplier_brand
        OR product_enrichment_jobs.oem<>EXCLUDED.oem)`, [ids.slice(at, at + enqueueChunk)])).rowCount ?? 0;
  }
  return written;
}
