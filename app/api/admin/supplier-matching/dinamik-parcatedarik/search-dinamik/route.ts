import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'model-match:search',
    limit: 200,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)), 100)

  if (!q || q.length < 2) {
    return successResponse([], context)
  }

  try {
    const pattern = `%${q}%`

    const results = await db.$queryRaw<
      Array<{
        id: bigint
        stock_code: string
        stock_name: string | null
        brand: string | null
        barcode_1: string | null
        barcode_2: string | null
        barcode_3: string | null
        price: string | null
      }>
    >(Prisma.sql`
      SELECT d.id, d.stock_code, d.stock_name, d.brand,
             d.barcode_1, d.barcode_2, d.barcode_3, d.price::text
      FROM dinamik.products d
      WHERE d.stock_code ILIKE ${pattern}
         OR d.stock_name ILIKE ${pattern}
         OR d.brand ILIKE ${pattern}
         OR d.barcode_1 ILIKE ${pattern}
         OR d.barcode_2 ILIKE ${pattern}
         OR d.barcode_3 ILIKE ${pattern}
      ORDER BY d.stock_code ASC
      LIMIT ${limit}
    `)

    const serialized = results.map(r => ({
      id: r.id.toString(),
      stockCode: r.stock_code,
      stockName: r.stock_name,
      brand: r.brand,
      barcode1: r.barcode_1,
      barcode2: r.barcode_2,
      barcode3: r.barcode_3,
      price: r.price
    }))

    return successResponse(serialized, context)
  } catch (error) {
    console.error('[search-dinamik] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Dinamik ürün arama hatası.', context })
  }
}