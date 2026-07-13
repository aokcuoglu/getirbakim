import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  resolvePricingPolicy,
  type PricingPolicy
} from '@/lib/pricing/calculate-selling-price'
import { SUPPLIER_BASBUG, SUPPLIER_DINAMIK } from './catalog-sql'

export interface RefreshOffersStats {
  updated: number
  deactivated: number
}

async function getSupplierPolicy(code: string): Promise<PricingPolicy> {
  const supplier = await db.suppliers.findUnique({
    where: { code },
    select: { pricing_policy: true }
  })
  return resolvePricingPolicy(supplier?.pricing_policy ?? null)
}

async function touchSupplierSyncTime(code: string): Promise<void> {
  await db.suppliers.update({
    where: { code },
    data: { last_offer_sync_at: new Date() }
  })
}

/**
 * Refresh price/stock/active state of all Dinamik offers from the raw layer
 * (catalog.supplier_dinamik_products + catalog.supplier_dinamik_cost),
 * materializing the cost → sell chain with the same math as
 * calculateSellingPrice():
 *   net  = round(price × (1 − standardDiscountRate) × (1 − campaignRate), 2)
 *   sell = round(net × (1 + marginRate) + fixedFee, 2)
 * campaign_rate > 1 is treated as a percentage, mirroring normalizeRate().
 */
export async function refreshDinamikOffers(): Promise<RefreshOffersStats> {
  const policy = await getSupplierPolicy(SUPPLIER_DINAMIK)

  const updated = await db.$executeRaw(Prisma.sql`
    WITH src AS (
      SELECT
        dp.id AS dnmk_id,
        dp.is_passive,
        dc.price,
        dc.stock_qty,
        dc.campaign_rate,
        dc.regional_stock,
        ROUND(
          (
            dc.price
            * (1 - ${policy.standardDiscountRate})
            * (1 - LEAST(1, GREATEST(0,
                CASE
                  WHEN COALESCE(dc.campaign_rate, 0) > 1 THEN dc.campaign_rate / 100
                  ELSE COALESCE(dc.campaign_rate, 0)
                END
              )))
          )::numeric, 2
        ) AS net_cost
      FROM catalog.supplier_dinamik_products dp
      LEFT JOIN catalog.supplier_dinamik_cost dc ON dc.product_id = dp.id
    )
    UPDATE catalog.product_offers po
    SET
      list_price = src.price,
      currency = 'TRY',
      fx_rate = NULL,
      fx_date = NULL,
      campaign_rate = src.campaign_rate,
      cost_try = src.price,
      net_cost_try = src.net_cost,
      selling_price_try = CASE
        WHEN src.net_cost IS NULL THEN NULL
        ELSE ROUND((src.net_cost * (1 + ${policy.marginRate}) + ${policy.fixedFee})::numeric, 2)
      END,
      stock_qty = COALESCE(src.stock_qty, 0),
      stock_breakdown = src.regional_stock,
      is_active = NOT src.is_passive,
      priced_at = NOW(),
      last_synced_at = NOW(),
      updated_at = NOW()
    FROM src
    WHERE po.dinamik_product_id = src.dnmk_id
  `)

  const [row] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM catalog.product_offers
    WHERE supplier_code = ${SUPPLIER_DINAMIK} AND is_active = false
  `)

  await touchSupplierSyncTime(SUPPLIER_DINAMIK)
  return { updated: Number(updated), deactivated: Number(row?.count ?? 0) }
}

/**
 * Refresh price/active state of all Başbuğ offers. List price is in the
 * supplier's currency (para_birimi, TL→TRY); non-TRY prices are converted
 * with the latest catalog.supplier_basbug_rates (satış) snapshot for that
 * currency.
 * Stock stays 0 until the StokGetir endpoint is wired into ingestion.
 */
export async function refreshBasbugOffers(): Promise<RefreshOffersStats> {
  const policy = await getSupplierPolicy(SUPPLIER_BASBUG)

  const updated = await db.$executeRaw(Prisma.sql`
    WITH priced AS (
      SELECT
        bp.id AS bsbg_id,
        bp.is_passive,
        bp.liste_fiyati,
        cur.currency,
        CASE WHEN cur.currency = 'TRY' THEN NULL ELSE r.satis END AS fx_rate,
        CASE WHEN cur.currency = 'TRY' THEN NULL ELSE r.tarih END AS fx_date,
        CASE
          WHEN bp.liste_fiyati IS NULL THEN NULL
          WHEN cur.currency = 'TRY' THEN bp.liste_fiyati
          WHEN r.satis IS NULL THEN NULL
          ELSE ROUND((bp.liste_fiyati * r.satis)::numeric, 2)
        END AS cost_try
      FROM catalog.supplier_basbug_products bp
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN COALESCE(NULLIF(UPPER(TRIM(bp.para_birimi)), ''), 'TRY') IN ('TL', 'TRY') THEN 'TRY'
          ELSE UPPER(TRIM(bp.para_birimi))
        END AS currency
      ) cur
      LEFT JOIN LATERAL (
        SELECT br.satis, br.tarih
        FROM catalog.supplier_basbug_rates br
        WHERE br.doviz_cinsi = cur.currency
        ORDER BY br.tarih DESC
        LIMIT 1
      ) r ON cur.currency <> 'TRY'
    ),
    src AS (
      SELECT
        priced.*,
        ROUND((priced.cost_try * (1 - ${policy.standardDiscountRate}))::numeric, 2) AS net_cost
      FROM priced
    )
    UPDATE catalog.product_offers po
    SET
      list_price = src.liste_fiyati,
      currency = src.currency,
      fx_rate = src.fx_rate,
      fx_date = src.fx_date,
      campaign_rate = NULL,
      cost_try = src.cost_try,
      net_cost_try = src.net_cost,
      selling_price_try = CASE
        WHEN src.net_cost IS NULL THEN NULL
        ELSE ROUND((src.net_cost * (1 + ${policy.marginRate}) + ${policy.fixedFee})::numeric, 2)
      END,
      is_active = NOT src.is_passive,
      priced_at = NOW(),
      last_synced_at = NOW(),
      updated_at = NOW()
    FROM src
    WHERE po.basbug_product_id = src.bsbg_id
  `)

  const [row] = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*) AS count
    FROM catalog.product_offers
    WHERE supplier_code = ${SUPPLIER_BASBUG} AND is_active = false
  `)

  await touchSupplierSyncTime(SUPPLIER_BASBUG)
  return { updated: Number(updated), deactivated: Number(row?.count ?? 0) }
}