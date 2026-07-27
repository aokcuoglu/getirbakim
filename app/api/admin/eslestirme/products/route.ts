import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import { getProductMatchOverview } from '@/lib/admin/product-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:overview',
    limit: 100,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const overview = await getProductMatchOverview()
    return successResponse(overview, context)
  } catch (error) {
    console.error('[eslestirme:products:overview] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Ürün kapsama verisi yüklenirken hata oluştu.',
      context
    })
  }
}
