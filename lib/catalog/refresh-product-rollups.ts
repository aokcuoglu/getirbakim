import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export interface RollupStats {
  rollupsUpdated: number
  slugsFilled: number
}

/**
 * Recompute the offer rollup cache on catalog.products
 * (min_selling_price_try / total_stock_qty / in_stock / offer_count).
 * A locked product_overrides.selling_price_override wins over MIN(offer).
 * updated_at is bumped only on real change so the Meilisearch watermark
 * does not churn on no-op syncs. Also fills missing SEO slugs.
 */
export async function refreshProductRollups(): Promise<RollupStats> {
  const rollupsUpdated = await db.$executeRaw(Prisma.sql`
    WITH agg AS (
      SELECT
        p.id,
        MIN(po.selling_price_try) FILTER (WHERE po.is_active) AS min_sell,
        COALESCE(SUM(po.stock_qty) FILTER (WHERE po.is_active), 0)::int AS total_stock,
        COUNT(po.id) FILTER (WHERE po.is_active)::int AS offer_count
      FROM catalog.products p
      LEFT JOIN catalog.product_offers po ON po.product_id = p.id
      GROUP BY p.id
    ),
    eff AS (
      SELECT
        a.id,
        CASE
          WHEN o.lock_price AND o.selling_price_override IS NOT NULL THEN o.selling_price_override
          ELSE a.min_sell
        END AS min_sell,
        a.total_stock,
        a.offer_count
      FROM agg a
      LEFT JOIN catalog.product_overrides o ON o.product_id = a.id
    )
    UPDATE catalog.products p
    SET
      min_selling_price_try = e.min_sell,
      total_stock_qty = e.total_stock,
      in_stock = e.total_stock > 0,
      offer_count = e.offer_count,
      updated_at = NOW()
    FROM eff e
    WHERE p.id = e.id
      AND (
        p.min_selling_price_try IS DISTINCT FROM e.min_sell
        OR p.total_stock_qty <> e.total_stock
        OR p.in_stock <> (e.total_stock > 0)
        OR p.offer_count <> e.offer_count
      )
  `)

  const slugsFilled = await db.$executeRaw(Prisma.sql`
    UPDATE catalog.products p
    SET slug = TRIM(BOTH '-' FROM
      LOWER(
        REGEXP_REPLACE(
          TRANSLATE(bl.brand || '-' || p.part_no, 'çğıöşüÇĞİÖŞÜ', 'cgiosucgiosu'),
          '[^a-zA-Z0-9]+', '-', 'g'
        )
      )
    ) || '-' || p.id
    FROM catalog.brands bl
    WHERE bl.id = p.brand_list_id
      AND p.slug IS NULL
  `)

  return { rollupsUpdated: Number(rollupsUpdated), slugsFilled: Number(slugsFilled) }
}

/**
 * Recompute the offer rollup for a single product. Called after an admin
 * override change (price override / lock) so the cached
 * min_selling_price_try / stock / offer_count reflect the new state
 * immediately, without waiting for the next full sync.
 */
export async function refreshSingleProductRollup(productId: bigint): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    WITH agg AS (
      SELECT
        MIN(po.selling_price_try) FILTER (WHERE po.is_active) AS min_sell,
        COALESCE(SUM(po.stock_qty) FILTER (WHERE po.is_active), 0)::int AS total_stock,
        COUNT(po.id) FILTER (WHERE po.is_active)::int AS offer_count
      FROM catalog.product_offers po
      WHERE po.product_id = ${productId}
    ),
    eff AS (
      SELECT
        CASE
          WHEN o.lock_price AND o.selling_price_override IS NOT NULL THEN o.selling_price_override
          ELSE a.min_sell
        END AS min_sell,
        a.total_stock,
        a.offer_count
      FROM agg a
      LEFT JOIN catalog.product_overrides o ON o.product_id = ${productId}
    )
    UPDATE catalog.products p
    SET
      min_selling_price_try = e.min_sell,
      total_stock_qty = e.total_stock,
      in_stock = e.total_stock > 0,
      offer_count = e.offer_count,
      updated_at = NOW()
    FROM eff e
    WHERE p.id = ${productId}
  `)
}
