import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

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

  if (!q || q.length < 2) return successResponse([], context)

  const escaped = q.replace(/[%_\\]/g, '\\$&')
  const pattern = `%${escaped}%`

  try {
    if (direction === 'from_product' && productIdStr) {
      const productId = Number(productIdStr)
      if (isNaN(productId) || productId <= 0) return errorResponse({ status: 400, code: 'INVALID_PRODUCT_ID', message: 'Geçersiz ürün ID.', context })

      // Get the manufacturer_id of this product, then find dproducts with matching brand
      const results = await db.$queryRaw<Array<{ id: bigint; stock_code: string; stock_name: string | null; brand: string | null; barcode_1: string | null; barcode_2: string | null; barcode_3: string | null; part_no: string | null }>>(
        Prisma.sql`
          SELECT d.id, d.stock_code, d.stock_name, d.brand, d.barcode_1, d.barcode_2, d.barcode_3, d.part_no
          FROM parcatedarik.dproducts d
          WHERE EXISTS (
            SELECT 1 FROM parcatedarik.product p
            JOIN parcatedarik.dbrands_match alias ON alias.manufacturer_id = p.manufacturer_id AND alias.mapping_status = 'APPROVED'
            WHERE p.id = ${productId}
              AND BTRIM(LOWER(alias.dbrands_id)) = BTRIM(LOWER(COALESCE(d.brand, '')))
          )
          AND (d.stock_code ILIKE ${pattern} OR d.stock_name ILIKE ${pattern} OR d.brand ILIKE ${pattern} OR d.barcode_1 ILIKE ${pattern} OR d.barcode_2 ILIKE ${pattern} OR d.barcode_3 ILIKE ${pattern} OR d.part_no ILIKE ${pattern})
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

      // Get the brand of this dproduct, then find products with matching manufacturer
      const results = await db.$queryRaw<Array<{ id: number; title: string; model: string | null; manufacturer_id: number; manufacturer_name: string }>>(
        Prisma.sql`
          SELECT p.id, p.title, p.model, p.manufacturer_id, mfr.name AS manufacturer_name
          FROM parcatedarik.product p
          JOIN parcatedarik.manufacturer mfr ON mfr.id = p.manufacturer_id
          WHERE EXISTS (
            SELECT 1 FROM parcatedarik.dproducts d
            JOIN parcatedarik.dbrands_match alias ON alias.mapping_status = 'APPROVED'
              AND alias.manufacturer_id = p.manufacturer_id
              AND BTRIM(LOWER(alias.dbrands_id)) = BTRIM(LOWER(COALESCE(d.brand, '')))
            WHERE d.id = ${dproductsId}
          )
          AND (p.title ILIKE ${pattern} OR p.model ILIKE ${pattern} OR mfr.name ILIKE ${pattern})
          ORDER BY p.title ASC
          LIMIT ${limit}
        `
      )
      return successResponse(results.map(r => ({
        id: r.id,
        title: r.title,
        model: r.model,
        manufacturerId: r.manufacturer_id,
        manufacturerName: r.manufacturer_name,
      })), context)
    }

    return errorResponse({ status: 400, code: 'MISSING_DIRECTION', message: 'direction=from_product&productId=X OR direction=from_dproducts&dproductsId=X gerekli.', context })
  } catch (error) {
    console.error('[eslestirme:models:search] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Arama sırasında hata oluştu.', context })
  }
}
