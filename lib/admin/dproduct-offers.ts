import { Prisma } from '@prisma/client'
import type { DinamikStockItem } from '@/lib/suppliers/dinamik-client'
import { db } from '@/lib/db'

const BATCH_SIZE = 400

export type DproductOfferRow = {
  stock_code: string
  price: number | null
  stock_qty: number | null
  campaign_rate: number | null
  regional_stock: unknown | null
  raw: Record<string, unknown>
}

function mapItemToOfferRow(item: DinamikStockItem): DproductOfferRow {
  const stockQty =
    typeof item.stokAdedi === 'number' && Number.isFinite(item.stokAdedi)
      ? Math.trunc(item.stokAdedi)
      : null
  const campaignRate =
    typeof item.campaignRate === 'number' && Number.isFinite(item.campaignRate)
      ? item.campaignRate
      : null

  return {
    stock_code: item.stokKodu.trim(),
    price: item.fiyat,
    stock_qty: stockQty,
    campaign_rate: campaignRate,
    regional_stock: item.regionalStock,
    raw: (item.raw ?? {}) as Record<string, unknown>
  }
}

export async function batchUpsertDproductOffers(
  queryBrand: string,
  items: DinamikStockItem[],
  dryRun: boolean
): Promise<{ upserted: number; historyInserted: number }> {
  const rows = items
    .map((item) => mapItemToOfferRow(item))
    .filter((row) => row.stock_code.length > 0)

  if (rows.length === 0) return { upserted: 0, historyInserted: 0 }
  if (dryRun) return { upserted: rows.length, historyInserted: 0 }

  let upserted = 0
  let historyInserted = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const stockCodes = batch.map((row) => row.stock_code)

    const existing = await db.$queryRaw<
      Array<{
        dproduct_id: bigint
        stock_code: string
        price: string | null
        stock_qty: number | null
      }>
    >(Prisma.sql`
      SELECT d.id AS dproduct_id, d.stock_code, o.price::text AS price, o.stock_qty
      FROM parcatedarik.dproducts d
      LEFT JOIN parcatedarik.dproduct_offers o ON o.dproduct_id = d.id
      WHERE d.query_brand = ${queryBrand}
        AND d.stock_code IN (${Prisma.join(stockCodes.map((code) => Prisma.sql`${code}`))})
    `)

    const existingByCode = new Map(
      existing.map((row) => [
        row.stock_code,
        {
          dproduct_id: row.dproduct_id,
          price: row.price != null ? Number(row.price) : null,
          stock_qty: row.stock_qty
        }
      ])
    )

    const values = batch.map(
      (row) =>
        Prisma.sql`(
          ${row.stock_code},
          ${row.price},
          ${row.stock_qty},
          ${row.campaign_rate},
          ${row.regional_stock != null ? JSON.stringify(row.regional_stock) : null}::jsonb,
          ${JSON.stringify(row.raw)}::jsonb
        )`
    )

    const count = await db.$executeRaw(Prisma.sql`
      INSERT INTO parcatedarik.dproduct_offers (
        dproduct_id,
        price,
        stock_qty,
        campaign_rate,
        regional_stock,
        raw,
        source,
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
        'dinamik',
        NOW(),
        NOW()
      FROM (
        VALUES ${Prisma.join(values)})
      ) AS v(stock_code, price, stock_qty, campaign_rate, regional_stock, raw)
      INNER JOIN parcatedarik.dproducts d
        ON d.query_brand = ${queryBrand}
       AND d.stock_code = v.stock_code
      ON CONFLICT (dproduct_id) DO UPDATE SET
        price = COALESCE(EXCLUDED.price, parcatedarik.dproduct_offers.price),
        stock_qty = EXCLUDED.stock_qty,
        campaign_rate = EXCLUDED.campaign_rate,
        regional_stock = EXCLUDED.regional_stock,
        raw = EXCLUDED.raw,
        last_seen_at = NOW(),
        updated_at = NOW()
    `)
    upserted += Number(count)

    const historyValues = batch
      .map((row) => {
        const prev = existingByCode.get(row.stock_code)
        if (!prev) return null
        const priceChanged =
          row.price != null &&
          (prev.price == null || Math.abs(prev.price - row.price) > 0.0001)
        const stockChanged =
          row.stock_qty != null && row.stock_qty !== prev.stock_qty
        if (!priceChanged && !stockChanged) return null
        return Prisma.sql`(
          ${prev.dproduct_id},
          ${row.price},
          ${row.stock_qty},
          NOW()
        )`
      })
      .filter((value): value is Prisma.Sql => value != null)

    if (historyValues.length > 0) {
      const histCount = await db.$executeRaw(Prisma.sql`
        INSERT INTO parcatedarik.dproduct_offer_history (
          dproduct_id,
          price,
          stock_qty,
          captured_at
        )
        VALUES ${Prisma.join(historyValues)}
      `)
      historyInserted += Number(histCount)
    }
  }

  return { upserted, historyInserted }
}
