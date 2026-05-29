/**
 * Backfill approved Dinamik-ParcaTedarik match offer stock
 *
 * Approved matches created before the stock propagation fix have
 * supplier_stock_qty = 0 in part_supplier_offers because the approve
 * action hardcoded 0 instead of reading from supplier_products.
 *
 * This script:
 * 1. Finds APPROVED matches in dpprd
 * 2. Looks up the corresponding supplier_products row for stock/price
 * 3. Updates part_supplier_offers with correct stock and price
 * 4. Optionally applies pricing policy for affected parts
 *
 * Usage:
 *   DRY_RUN=true bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts
 *   APPLY=true bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts
 *   APPLY=true LIMIT=5 bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts
 *   APPLY=true MATCH_ID=123 bun scripts/backfill-approved-dinamik-parcatedarik-offer-stock.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'
import {
  calculateSellingPrice,
  normalizeRate,
  resolvePricingPolicyFromProviderConfig
} from '../lib/pricing/calculate-selling-price'

const DRY_RUN = process.env.APPLY === 'true' ? false : process.env.DRY_RUN !== 'false'
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined
const MATCH_ID = process.env.MATCH_ID || undefined

function normalizeNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

type OfferPolicyRow = {
  provider_id: bigint
  supplier_product_id: bigint
  supplier_price: string | null
  supplier_stock_qty: number
  currency: string | null
  priority: number
  campaign_rate: string | null
  provider_config: unknown
}

async function applyPolicyForPart(partId: bigint) {
  const offers = await db.$queryRaw<OfferPolicyRow[]>(Prisma.sql`
    SELECT
      o.provider_id,
      o.supplier_product_id,
      o.supplier_price::text AS supplier_price,
      o.supplier_stock_qty,
      o.currency,
      p.priority,
      o.campaign_rate::text AS campaign_rate,
      p.config AS provider_config
    FROM part_supplier_offers o
    JOIN supplier_providers p ON p.id = o.provider_id
    WHERE o.part_id = ${partId}
      AND o.is_active = TRUE
      AND p.status = 'ACTIVE'
    ORDER BY p.priority ASC, o.updated_at DESC
  `)

  const scoredOffers = offers.map((row) => {
    const policy = resolvePricingPolicyFromProviderConfig(row.provider_config)
    const calculation = calculateSellingPrice({
      supplierPrice: normalizeNumber(row.supplier_price),
      campaignRate: normalizeRate(row.campaign_rate, 0),
      policy
    })

    return {
      row,
      policy,
      calculation,
      hasStock: row.supplier_stock_qty > 0,
      netCost: calculation.netCostExVat ?? Number.POSITIVE_INFINITY
    }
  })

  scoredOffers.sort((a, b) => {
    if (a.hasStock !== b.hasStock) {
      return a.hasStock ? -1 : 1
    }

    if (a.netCost !== b.netCost) {
      return a.netCost - b.netCost
    }

    return a.row.priority - b.row.priority
  })

  const selected = scoredOffers[0] ?? null

  await db.part_pricing_inventory.upsert({
    where: { part_id: partId },
    update: {
      supplier_price: selected?.row.supplier_price
        ? new Prisma.Decimal(selected.row.supplier_price)
        : null,
      computed_cost_ex_vat:
        selected?.calculation.netCostExVat != null
          ? new Prisma.Decimal(selected.calculation.netCostExVat)
          : null,
      computed_selling_price_ex_vat:
        selected?.calculation.sellingExVat != null
          ? new Prisma.Decimal(selected.calculation.sellingExVat)
          : null,
      supplier_stock_qty: selected?.row.supplier_stock_qty ?? 0,
      sync_status: selected ? 'OK' : 'ERROR',
      source_provider_id: selected?.row.provider_id != null ? Number(selected.row.provider_id) : null,
      source_supplier_product_id: selected?.row.supplier_product_id != null ? Number(selected.row.supplier_product_id) : null,
      currency: selected?.row.currency || 'TRY',
      last_synced_at: new Date(),
      last_policy_at: new Date()
    },
    create: {
      part_id: partId,
      supplier_price: selected?.row.supplier_price
        ? new Prisma.Decimal(selected.row.supplier_price)
        : null,
      computed_cost_ex_vat:
        selected?.calculation.netCostExVat != null
          ? new Prisma.Decimal(selected.calculation.netCostExVat)
          : null,
      computed_selling_price_ex_vat:
        selected?.calculation.sellingExVat != null
          ? new Prisma.Decimal(selected.calculation.sellingExVat)
          : null,
      supplier_stock_qty: selected?.row.supplier_stock_qty ?? 0,
      reserved_stock_qty: 0,
      min_stock_level: 3,
      sync_status: selected ? 'OK' : 'ERROR',
      source_provider_id: selected?.row.provider_id != null ? Number(selected.row.provider_id) : null,
      source_supplier_product_id: selected?.row.supplier_product_id != null ? Number(selected.row.supplier_product_id) : null,
      currency: selected?.row.currency || 'TRY',
      last_synced_at: new Date(),
      last_policy_at: new Date()
    }
  })

  await db.part_admin_overrides.updateMany({
    where: {
      part_id: partId,
      lock_price: false
    },
    data: {
      selling_price_override: null
    }
  })

  await db.part_admin_overrides.updateMany({
    where: {
      part_id: partId,
      lock_visibility: false
    },
    data: {
      is_visible: true
    }
  })
}

async function main() {
  console.log('=== Backfill Approved Dinamik-ParcaTedarik Offer Stock ===')
  console.log(`DRY_RUN=${DRY_RUN}`)
  if (LIMIT) console.log(`LIMIT=${LIMIT}`)
  if (MATCH_ID) console.log(`MATCH_ID=${MATCH_ID}`)
  console.log()

  const stats = {
    approvedMatchesScanned: 0,
    supplierProductsFound: 0,
    offersFound: 0,
    offersWouldUpdate: 0,
    offersUpdated: 0,
    policiesWouldRefresh: 0,
    policiesRefreshed: 0,
    missingSupplierProducts: 0,
    missingOffers: 0,
    errors: 0
  }

  const dinamikProvider = await db.supplier_providers.findFirst({
    where: { code: { contains: 'dinamik', mode: 'insensitive' } }
  })

  if (!dinamikProvider) {
    console.error('[backfill] No Dinamik provider found. Exiting.')
    process.exit(1)
  }

  console.log(`Dinamik provider: id=${dinamikProvider.id} code=${dinamikProvider.code}`)

  const whereConditions: Prisma.Sql[] = [
    Prisma.sql`m.status = 'APPROVED'`
  ]

  if (MATCH_ID) {
    whereConditions.push(Prisma.sql`m.id = ${BigInt(MATCH_ID)}`)
  }

  const whereClause = whereConditions.length > 0
    ? Prisma.sql`WHERE ${Prisma.join(whereConditions, ' AND ')}`
    : Prisma.sql``

  const limitClause = LIMIT ? Prisma.sql`LIMIT ${LIMIT}` : Prisma.sql``

  const matches = await db.$queryRaw<
    Array<{
      id: bigint
      dinamik_product_id: bigint
      parcatedarik_product_id: bigint
      match_reason: string
      confidence: bigint
    }>
  >(Prisma.sql`
    SELECT m.id, m.dinamik_product_id, m.parcatedarik_product_id, m.match_reason, m.confidence
    FROM v0.dnmk_ptdrk_products m
    ${whereClause}
    ORDER BY m.confidence DESC, m.created_at ASC
    ${limitClause}
  `)

  stats.approvedMatchesScanned = matches.length
  console.log(`Found ${matches.length} APPROVED matches`)

  for (const match of matches) {
    try {
      const dinamikProduct = await db.$queryRaw<
        Array<{ id: bigint; stock_code: string; price: string | null }>
      >(Prisma.sql`
        SELECT d.id, d.stock_code, o.price::text AS price
        FROM v0.dnmk_products d
        LEFT JOIN v0.dnmk_product_detail o ON o.dnmk_products_id = d.id
        WHERE d.id = ${match.dinamik_product_id}
      `)

      if (dinamikProduct.length === 0) {
        console.log(`  Match ${match.id}: Dinamik product not found`)
        stats.missingSupplierProducts++
        continue
      }

      const dp = dinamikProduct[0]

      const supplierProduct = await db.supplier_products.findFirst({
        where: {
          provider_id: dinamikProvider.id,
          supplier_sku: dp.stock_code
        }
      })

      if (!supplierProduct) {
        console.log(`  Match ${match.id}: No supplier_products row for stock_code=${dp.stock_code}`)
        stats.missingSupplierProducts++
        continue
      }

      stats.supplierProductsFound++

      const expectedStockQty = supplierProduct.supplier_stock_qty ?? 0
      const expectedPrice = supplierProduct.supplier_price ?? (dp.price ? new Prisma.Decimal(dp.price) : null)
      const expectedCurrency = supplierProduct.currency || 'TRY'

      const existingOffer = await db.part_supplier_offers.findFirst({
        where: {
          provider_id: dinamikProvider.id,
          supplier_product_id: supplierProduct.id
        }
      })

      if (!existingOffer) {
        console.log(`  Match ${match.id}: No part_supplier_offers row for supplier_product_id=${supplierProduct.id}`)
        stats.missingOffers++

        if (!DRY_RUN) {
          const mapping = await db.supplier_part_mappings.findFirst({
            where: {
              provider_id: dinamikProvider.id,
              supplier_product_id: supplierProduct.id
            }
          })

          if (mapping?.part_id) {
            await db.part_supplier_offers.create({
              data: {
                provider_id: dinamikProvider.id,
                supplier_product_id: supplierProduct.id,
                part_id: mapping.part_id,
                supplier_price: expectedPrice,
                supplier_stock_qty: expectedStockQty,
                currency: expectedCurrency,
                is_active: true
              }
            })
            console.log(`  Match ${match.id}: Created offer with stock=${expectedStockQty}`)
          }
        }
        continue
      }

      stats.offersFound++

      const currentStock = existingOffer.supplier_stock_qty
      const currentPrice = existingOffer.supplier_price?.toString() ?? null

      if (currentStock === expectedStockQty && currentPrice === (expectedPrice?.toString() ?? null)) {
        console.log(`  Match ${match.id}: Offer already has stock=${currentStock} price=${currentPrice} - no change needed`)
        continue
      }

      stats.offersWouldUpdate++

      console.log(
        `  Match ${match.id}: Offer update stock ${currentStock} -> ${expectedStockQty}, ` +
        `price ${currentPrice} -> ${expectedPrice?.toString() ?? null}`
      )

      if (!DRY_RUN) {
        await db.part_supplier_offers.update({
          where: { id: existingOffer.id },
          data: {
            supplier_stock_qty: expectedStockQty,
            supplier_price: expectedPrice,
            currency: expectedCurrency,
            is_active: true,
            updated_at: new Date(),
            last_synced_at: new Date()
          }
        })

        stats.offersUpdated++
      }

      if (existingOffer.part_id) {
        stats.policiesWouldRefresh++

        if (!DRY_RUN) {
          try {
            await applyPolicyForPart(existingOffer.part_id)
            stats.policiesRefreshed++
            console.log(`  Match ${match.id}: Applied pricing policy for part_id=${existingOffer.part_id.toString()}`)
          } catch (policyError) {
            console.error(`  Match ${match.id}: Pricing policy failed for part_id=${existingOffer.part_id.toString()}:`, policyError)
            stats.errors++
          }
        }
      }
    } catch (error) {
      console.error(`  Match ${match.id}: Error:`, error)
      stats.errors++
    }
  }

  console.log()
  console.log('=== Backfill Summary ===')
  console.log(`  approvedMatchesScanned: ${stats.approvedMatchesScanned}`)
  console.log(`  supplierProductsFound: ${stats.supplierProductsFound}`)
  console.log(`  offersFound: ${stats.offersFound}`)
  console.log(`  offersWouldUpdate: ${stats.offersWouldUpdate}`)
  console.log(`  offersUpdated: ${stats.offersUpdated}`)
  console.log(`  policiesWouldRefresh: ${stats.policiesWouldRefresh}`)
  console.log(`  policiesRefreshed: ${stats.policiesRefreshed}`)
  console.log(`  missingSupplierProducts: ${stats.missingSupplierProducts}`)
  console.log(`  missingOffers: ${stats.missingOffers}`)
  console.log(`  errors: ${stats.errors}`)
  console.log()
  console.log(`DRY_RUN=${DRY_RUN}`)

  await db.$disconnect()
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err)
  process.exit(1)
})