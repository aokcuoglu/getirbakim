import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { runProductMatching } from '@/lib/admin/product-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Eşleştirme onaylı marka sayısıyla ölçeklenir; ağır bir çalışmaya karşı 5 dk.
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:run',
    limit: 10,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

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
