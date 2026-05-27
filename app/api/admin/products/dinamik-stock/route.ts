import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { getStockBySku } from '@/lib/suppliers/dinamik-client'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin-dinamik-stock',
    limit: 60,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const auth = await getAdminAuth()
  if (!auth?.user) {
    return errorResponse({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      context
    })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({
      status: 403,
      code: 'ADMIN_REQUIRED',
      message: 'Admin access required.',
      context
    })
  }

  try {
    const body = await request.json()
    const stockCode = typeof body?.stockCode === 'string' ? body.stockCode.trim() : ''

    if (!stockCode) {
      return errorResponse({
        status: 400,
        code: 'STOCK_CODE_REQUIRED',
        message: 'stockCode zorunludur.',
        context
      })
    }

    const result = await getStockBySku(stockCode)

    if (!result) {
      return successResponse(
        { sku: stockCode, found: false, regionalStock: null },
        context
      )
    }

    return successResponse(
      {
        sku: result.stokKodu,
        brand: result.marka,
        name: result.stokAdi,
        found: true,
        price: result.fiyat,
        stockQty: result.stokAdedi,
        campaignRate: result.campaignRate,
        regionalStock: result.regionalStock
          ? Object.entries(result.regionalStock).map(([key, entry]) => ({
              warehouse: key,
              status: entry.status,
              hasStock: entry.hasStock,
              qty: entry.qty
            }))
          : null
      },
      context
    )
  } catch (error) {
    console.error('Error in /api/admin/products/dinamik-stock:', error)
    return errorResponse({
      status: 500,
      code: 'DINAMIK_STOCK_QUERY_FAILED',
      message: 'Dinamik stok sorgusu basarisiz.',
      context
    })
  }
}