import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { bestOffersSql } from './best-offer'

export interface RollupStats {
  rollupsUpdated: number
  slugsFilled: number
}

/**
 * Recompute the offer rollup cache on catalog.products
 * (min_selling_price_try / total_stock_qty / in_stock / offer_count).
 * Tedarikçi başına yalnız EN İYİ offer sayılır (bkz best-offer.ts) — aynı
 * tedarikçinin aynı parça için ikinci listesi fiyatı düşürmez, stoğu iki kez
 * saydırmaz, ama bağlı satır stoksuz kalınca devri kendiliğinden alır.
 * A locked product_overrides.selling_price_override wins over MIN(offer).
 * updated_at is bumped only on real change so downstream caches
 * does not churn on no-op syncs. Also fills missing SEO slugs.
 */
export async function refreshProductRollups(): Promise<RollupStats> {
  const rollupsUpdated = await db.$executeRaw(Prisma.sql`
    WITH best AS (${bestOffersSql()}),
    agg AS (
      SELECT
        p.id,
        MIN(b.selling_price_try) AS min_sell,
        COALESCE(SUM(b.stock_qty), 0)::int AS total_stock,
        COUNT(b.id)::int AS offer_count
      FROM catalog.products p
      LEFT JOIN best b ON b.product_id = p.id
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
    WHERE bl.id = p.brand_id
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
/**
 * Toplu varyant: verilen kanonik ürünlerin rollup'ını tek geçişte tazeler.
 * CSV içe aktarma gibi yüzlerce ürüne dokunan akışlar için — ürün başına ayrı
 * UPDATE atmak yerine 1000'lik partiler hâlinde çalışır.
 */
export async function refreshProductRollupsForIds(productIds: bigint[]): Promise<void> {
  if (productIds.length === 0) return

  for (let i = 0; i < productIds.length; i += 1_000) {
    const part = productIds.slice(i, i + 1_000)
    await db.$executeRaw(Prisma.sql`
      WITH best AS (${bestOffersSql(Prisma.sql`po.product_id IN (${Prisma.join(part)})`)}),
      agg AS (
        SELECT
          p.id,
          MIN(b.selling_price_try) AS min_sell,
          COALESCE(SUM(b.stock_qty), 0)::int AS total_stock,
          COUNT(b.id)::int AS offer_count
        FROM catalog.products p
        LEFT JOIN best b ON b.product_id = p.id
        WHERE p.id IN (${Prisma.join(part)})
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
    `)
  }
}

export async function refreshSingleProductRollup(productId: bigint): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    WITH best AS (${bestOffersSql(Prisma.sql`po.product_id = ${productId}`)}),
    agg AS (
      SELECT
        MIN(b.selling_price_try) AS min_sell,
        COALESCE(SUM(b.stock_qty), 0)::int AS total_stock,
        COUNT(b.id)::int AS offer_count
      FROM best b
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
