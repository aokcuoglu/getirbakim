import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  dproductDbrandJoin,
  dproductBrandNameExpr
} from '@/lib/sql/dnprd-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr
} from '@/lib/sql/dnprd-details'

const VALID_SORT_COLUMNS: Record<string, string> = {
  stock_code: 'd.stock_code',
  brand: 'db.brand',
  price: 'offer_price',
  stock_name: 'd.stock_name'
}

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:list',
    limit: 200,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 100)
  const offset = (page - 1) * limit
  const sortCol = url.searchParams.get('sort')
  const sortDirRaw = url.searchParams.get('sort_dir')?.toLowerCase()
  const sortDir = sortDirRaw === 'desc' ? 'DESC' : 'ASC'

  const orderBy =
    sortCol === 'price'
      ? Prisma.sql`${dproductDetailsPriceExpr} ${Prisma.raw(sortDir)} NULLS LAST`
      : Prisma.sql`${Prisma.raw(
          sortCol && VALID_SORT_COLUMNS[sortCol] ? VALID_SORT_COLUMNS[sortCol] : 'd.stock_code'
        )} ${Prisma.raw(sortDir)}`

  try {
    const qCondition = q
      ? Prisma.sql`AND d.is_passive = false AND (d.stock_code ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`} OR d.stock_name ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`} OR ${dproductBrandNameExpr} ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`})`
      : Prisma.sql`AND d.is_passive = false`

    const [countRows, summaryRows, rows] = await Promise.all([
      db.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM v0.dnmk_products d ${dproductDbrandJoin} ${dproductDetailsJoin} WHERE 1=1 ${qCondition}`
      ),
      db.$queryRaw<Array<{ total: bigint; distinct_brands: bigint; priced_rows: bigint; with_barcode: bigint }>>(
        Prisma.sql`
          SELECT
            COUNT(*)::int AS total,
            COUNT(DISTINCT d.dnmk_brands_id)::int AS distinct_brands,
            COUNT(*) FILTER (WHERE ${dproductDetailsPriceExpr} IS NOT NULL)::int AS priced_rows,
            COUNT(*) FILTER (
              WHERE d.barcode_1 IS NOT NULL OR d.barcode_2 IS NOT NULL OR d.barcode_3 IS NOT NULL
            )::int AS with_barcode
          FROM v0.dnmk_products d
          ${dproductDbrandJoin}
          ${dproductDetailsJoin}
          WHERE 1=1 ${qCondition}
        `
      ),
      db.$queryRaw<Array<{ id: bigint; stock_code: string; stock_name: string | null; brand: string | null; price: string | null; barcode_1: string | null; barcode_2: string | null; barcode_3: string | null }>>(
        Prisma.sql`
          SELECT
            d.id,
            d.stock_code,
            d.stock_name,
            ${dproductBrandNameExpr} AS brand,
            d.barcode_1,
            d.barcode_2,
            d.barcode_3,
            ${dproductDetailsPriceExpr}::text AS price
          FROM v0.dnmk_products d
          ${dproductDbrandJoin}
          ${dproductDetailsJoin}
          WHERE 1=1 ${qCondition}
          ORDER BY ${orderBy}
          LIMIT ${limit} OFFSET ${offset}
        `
      ),
    ])

    const total = Number(countRows[0]?.total ?? 0)
    const pages = Math.ceil(total / limit)
    const summary = summaryRows[0]

    return successResponse({
      rows: rows.map(r => ({
        id: r.id.toString(),
        stockCode: r.stock_code,
        stockName: r.stock_name,
        brand: r.brand,
        price: r.price,
        barcode1: r.barcode_1,
        barcode2: r.barcode_2,
        barcode3: r.barcode_3,
      })),
      pagination: { page, limit, total, pages },
      summary: summary ? {
        total: Number(summary.total),
        distinctBrands: Number(summary.distinct_brands),
        pricedRows: Number(summary.priced_rows),
        withBarcode: Number(summary.with_barcode),
      } : null,
      filters: { q },
    }, context)
  } catch (error) {
    console.error('[eslestirme:products:list] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Ürün listesi yüklenemedi.', context })
  }
}
