import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import { runProductMatching } from '@/lib/admin/product-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Eşleştirme onaylı marka sayısıyla ölçeklenir; ağır bir çalışmaya karşı 5 dk.
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:run',
    limit: 10,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const result = await runProductMatching()
    return successResponse(result, context)
  } catch (error) {
    console.error('[eslestirme:products:run] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Ürün eşleştirme çalıştırılırken hata oluştu.',
      context
    })
  }
}
