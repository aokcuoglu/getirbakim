import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { normalizeModel } from '@/lib/matching/code-normalization'
import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr } from '@/lib/sql/dproduct-catalog'

function buildDproductsTextFilter(q: string, pattern: string) {
  if (q.length < 2) return Prisma.empty
  const normalizedQ = normalizeModel(q)
  return Prisma.sql`AND (
    d.stock_code ILIKE ${pattern}
    OR d.stock_name ILIKE ${pattern}
    OR ${dproductBrandNameExpr} ILIKE ${pattern}
    OR d.barcode_1 ILIKE ${pattern}
    OR d.barcode_2 ILIKE ${pattern}
    OR d.barcode_3 ILIKE ${pattern}
    OR d.part_no ILIKE ${pattern}
    ${normalizedQ ? Prisma.sql`OR UPPER(REGEXP_REPLACE(COALESCE(d.barcode_1, ''), '[^A-Z0-9]', '', 'gi')) = ${normalizedQ}` : Prisma.empty}
    ${normalizedQ ? Prisma.sql`OR UPPER(REGEXP_REPLACE(COALESCE(d.barcode_2, ''), '[^A-Z0-9]', '', 'gi')) = ${normalizedQ}` : Prisma.empty}
    ${normalizedQ ? Prisma.sql`OR UPPER(REGEXP_REPLACE(COALESCE(d.barcode_3, ''), '[^A-Z0-9]', '', 'gi')) = ${normalizedQ}` : Prisma.empty}
  )`
}

function buildProductsTextFilter(q: string, pattern: string) {
  if (q.length < 2) return Prisma.empty
  const normalizedQ = normalizeModel(q)
  return Prisma.sql`AND (
    p.title ILIKE ${pattern}
    OR p.model ILIKE ${pattern}
    OR p.ref_no ILIKE ${pattern}
    OR mfr.name ILIKE ${pattern}
    ${normalizedQ ? Prisma.sql`OR p.normalized_model = ${normalizedQ}` : Prisma.empty}
  )`
}

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:search', limit: 200, windowMs: 60_000 })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const direction = url.searchParams.get('direction') ?? 'from_product'
  const productIdStr = url.searchParams.get('productId')
  const dproductsIdStr = url.searchParams.get('dproductsId')
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)), 100)

  const escaped = q.replace(/[%_\\]/g, '\\$&')
  const pattern = `%${escaped}%`
  const textFilterDproducts = buildDproductsTextFilter(q, pattern)
  const textFilterProducts = buildProductsTextFilter(q, pattern)

  try {
    if (direction === 'from_product' && productIdStr) {
      const productId = Number(productIdStr)
      if (isNaN(productId) || productId <= 0) return errorResponse({ status: 400, code: 'INVALID_PRODUCT_ID', message: 'Geçersiz ürün ID.', context })

      const results = await db.$queryRaw<Array<{ id: bigint; stock_code: string; stock_name: string | null; brand: string | null; barcode_1: string | null; barcode_2: string | null; barcode_3: string | null; part_no: string | null }>>(
        Prisma.sql`
          WITH matched_brands AS (
            SELECT DISTINCT BTRIM(LOWER(db.brand)) AS brand_norm
            FROM v0.ptproducts p
            JOIN v0.dbrands_match alias
              ON alias.ptbrands_id = p.ptbrands_id
             AND alias.mapping_status = 'APPROVED'
            JOIN v0.dbrands db ON db.id = alias.dbrands_id
            WHERE p.id = ${productId}
          )
          SELECT d.id, d.stock_code, d.stock_name, ${dproductBrandNameExpr} AS brand, d.barcode_1, d.barcode_2, d.barcode_3, d.part_no
          FROM v0.dproducts d
          INNER JOIN v0.dbrands db ON db.id = d.dbrands_id
          WHERE BTRIM(LOWER(COALESCE(${dproductBrandNameExpr}, ''))) IN (SELECT brand_norm FROM matched_brands)
          ${textFilterDproducts}
          ORDER BY d.stock_code ASC
          LIMIT ${limit}
        `
      )
      return successResponse(results.map(r => ({
        id: r.id.toString(),
        stockCode: r.stock_code,
        stockName: r.stock_name,
        brand: r.brand,
        barcode1: r.barcode_1,
        barcode2: r.barcode_2,
        barcode3: r.barcode_3,
        partNo: r.part_no,
      })), context)
    }

    if (direction === 'from_dproducts' && dproductsIdStr) {
      const dproductsId = BigInt(dproductsIdStr)

      const barcodeHintFilter = q.length < 2
        ? Prisma.sql`AND p.normalized_model IN (
            SELECT DISTINCT norm FROM (
              SELECT UPPER(REGEXP_REPLACE(COALESCE(barcode_1, ''), '[^A-Z0-9]', '', 'gi')) AS norm
              FROM v0.dproducts WHERE id = ${dproductsId}
              UNION ALL
              SELECT UPPER(REGEXP_REPLACE(COALESCE(barcode_2, ''), '[^A-Z0-9]', '', 'gi'))
              FROM v0.dproducts WHERE id = ${dproductsId}
              UNION ALL
              SELECT UPPER(REGEXP_REPLACE(COALESCE(barcode_3, ''), '[^A-Z0-9]', '', 'gi'))
              FROM v0.dproducts WHERE id = ${dproductsId}
              UNION ALL
              SELECT UPPER(REGEXP_REPLACE(COALESCE(part_no, ''), '[^A-Z0-9]', '', 'gi'))
              FROM v0.dproducts WHERE id = ${dproductsId}
              UNION ALL
              SELECT UPPER(REGEXP_REPLACE(COALESCE(stock_code, ''), '[^A-Z0-9]', '', 'gi'))
              FROM v0.dproducts WHERE id = ${dproductsId}
            ) hints
            WHERE norm <> ''
          )`
        : Prisma.empty

      const results = await db.$queryRaw<Array<{ id: number; title: string; model: string | null; ptbrands_id: number; manufacturer_name: string }>>(
        Prisma.sql`
          WITH dproduct AS (
            SELECT db.brand
            FROM v0.dproducts d
            INNER JOIN v0.dbrands db ON db.id = d.dbrands_id
            WHERE d.id = ${dproductsId}
          ),
          matched_mfrs AS (
            SELECT DISTINCT alias.ptbrands_id
            FROM dproduct d
            JOIN v0.dbrands_match alias
              ON alias.mapping_status = 'APPROVED'
             AND alias.ptbrands_id IS NOT NULL
            JOIN v0.dbrands db ON db.id = alias.dbrands_id
             AND BTRIM(LOWER(db.brand)) = BTRIM(LOWER(COALESCE(d.brand, '')))
          )
          SELECT p.id, p.title, p.model, p.ptbrands_id, mfr.name AS manufacturer_name
          FROM v0.ptproducts p
          JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
          WHERE p.ptbrands_id IN (SELECT ptbrands_id FROM matched_mfrs)
          ${q.length >= 2 ? textFilterProducts : barcodeHintFilter}
          ORDER BY p.title ASC
          LIMIT ${limit}
        `
      )

      if (results.length === 0 && q.length < 2) {
        const fallback = await db.$queryRaw<Array<{ id: number; title: string; model: string | null; ptbrands_id: number; manufacturer_name: string }>>(
          Prisma.sql`
            WITH dproduct AS (
              SELECT db.brand
              FROM v0.dproducts d
              INNER JOIN v0.dbrands db ON db.id = d.dbrands_id
              WHERE d.id = ${dproductsId}
            ),
            matched_mfrs AS (
              SELECT DISTINCT alias.ptbrands_id
              FROM dproduct d
              JOIN v0.dbrands_match alias
                ON alias.mapping_status = 'APPROVED'
               AND alias.ptbrands_id IS NOT NULL
              JOIN v0.dbrands db ON db.id = alias.dbrands_id
               AND BTRIM(LOWER(db.brand)) = BTRIM(LOWER(COALESCE(d.brand, '')))
            )
            SELECT p.id, p.title, p.model, p.ptbrands_id, mfr.name AS manufacturer_name
            FROM v0.ptproducts p
            JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
            WHERE p.ptbrands_id IN (SELECT ptbrands_id FROM matched_mfrs)
            ORDER BY p.title ASC
            LIMIT ${limit}
          `
        )
        return successResponse(fallback.map(r => ({
          id: r.id,
          title: r.title,
          model: r.model,
          manufacturerId: r.ptbrands_id,
          manufacturerName: r.manufacturer_name,
        })), context)
      }

      return successResponse(results.map(r => ({
        id: r.id,
        title: r.title,
        model: r.model,
        manufacturerId: r.ptbrands_id,
        manufacturerName: r.manufacturer_name,
      })), context)
    }

    return errorResponse({ status: 400, code: 'MISSING_DIRECTION', message: 'direction=from_product&productId=X OR direction=from_dproducts&dproductsId=X gerekli.', context })
  } catch (error) {
    console.error('[eslestirme:models:search] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Arama sırasında hata oluştu.', context })
  }
}
