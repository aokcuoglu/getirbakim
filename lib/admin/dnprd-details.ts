import { Prisma } from '@prisma/client'
import type { DinamikStockItem } from '@/lib/suppliers/dinamik-client'
import { db } from '@/lib/db'

const BATCH_SIZE = 400

export type DproductDetailsRow = {
  /** Full stokKodu for joining catalog.supplier_dinamik_cost.product_id. */
  fullStockCode: string
  price: number | null
  stock_qty: number | null
  campaign_rate: number | null
  regional_stock: unknown | null
  raw: Record<string, unknown>
}

function mapItemToDetailsRow(item: DinamikStockItem): DproductDetailsRow {
  const stockQty =
    typeof item.stokAdedi === 'number' && Number.isFinite(item.stokAdedi)
      ? Math.trunc(item.stokAdedi)
      : null
  const campaignRate =
    typeof item.campaignRate === 'number' && Number.isFinite(item.campaignRate)
      ? item.campaignRate
      : null

  const fullStockCode = item.stokKodu.trim()

  return {
    fullStockCode,
    price: item.fiyat,
    stock_qty: stockQty,
    campaign_rate: campaignRate,
    regional_stock: item.regionalStock,
    raw: (item.raw ?? {}) as Record<string, unknown>
  }
}

export async function batchUpsertDproductDetails(
  dnbrdId: bigint,
  items: DinamikStockItem[],
  dryRun: boolean
): Promise<{ upserted: number }> {
  const rows = items
    .map((item) => mapItemToDetailsRow(item))
    .filter((row) => row.fullStockCode.length > 0)

  if (rows.length === 0) return { upserted: 0 }
  if (dryRun) return { upserted: rows.length }

  let upserted = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const stockCodes = batch.map((row) => row.fullStockCode)

    const existing = await db.$queryRaw<
      Array<{
        dinamik_product_id: bigint
        stock_code: string
        price: string | null
        stock_qty: number | null
      }>
    >(Prisma.sql`
      SELECT d.id AS dinamik_product_id, d.stock_code, o.price::text AS price, o.stock_qty
      FROM catalog.supplier_dinamik_products d
      LEFT JOIN catalog.supplier_dinamik_cost o ON o.product_id = d.id
      WHERE d.brand_id = ${dnbrdId}
        AND d.stock_code IN (${Prisma.join(stockCodes.map((code) => Prisma.sql`${code}`))})
    `)

    const existingByCode = new Map(
      existing.map((row) => [
        row.stock_code,
        {
          dinamik_product_id: row.dinamik_product_id,
          price: row.price != null ? Number(row.price) : null,
          stock_qty: row.stock_qty
        }
      ])
    )

    const values = batch.map(
      (row) =>
        Prisma.sql`(
          ${row.fullStockCode}::text,
          ${row.price}::numeric,
          ${row.stock_qty}::int,
          ${row.campaign_rate}::numeric,
          ${row.regional_stock != null ? JSON.stringify(row.regional_stock) : null}::jsonb,
          ${JSON.stringify(row.raw)}::jsonb
        )`
    )

    const count = await db.$executeRaw(Prisma.sql`
      INSERT INTO catalog.supplier_dinamik_cost (
        product_id,
        price,
        stock_qty,
        campaign_rate,
        regional_stock,
        raw,
        last_seen_at,
        updated_at
      )
      SELECT
        d.id,
        v.price,
        v.stock_qty,
        v.campaign_rate,
        v.regional_stock,
        v.raw,
        NOW(),
        NOW()
      FROM (
        VALUES ${Prisma.join(values)}
      ) AS v(full_stock_code, price, stock_qty, campaign_rate, regional_stock, raw)
      INNER JOIN catalog.supplier_dinamik_products d
        ON d.brand_id = ${dnbrdId}
       AND d.stock_code = v.full_stock_code
      ON CONFLICT (product_id) DO UPDATE SET
        price = COALESCE(EXCLUDED.price, catalog.supplier_dinamik_cost.price),
        stock_qty = EXCLUDED.stock_qty,
        campaign_rate = EXCLUDED.campaign_rate,
        regional_stock = EXCLUDED.regional_stock,
        raw = EXCLUDED.raw,
        last_seen_at = NOW(),
        updated_at = NOW()
    `)
    upserted += Number(count)
  }

  return { upserted }
}
