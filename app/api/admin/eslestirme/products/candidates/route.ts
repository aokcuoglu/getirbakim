import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import { listPendingProductCandidates } from '@/lib/admin/product-match-candidates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:candidates',
    limit: 100,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const url = request.nextUrl
    const q = url.searchParams.get('q') ?? undefined
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50), 200)

    const result = await listPendingProductCandidates({ q, page, limit })
    return successResponse(result, context)
  } catch (error) {
    console.error('[eslestirme:products:candidates] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Bekleyen eşleştirme adayları yüklenirken hata oluştu.',
      context
    })
  }
}
