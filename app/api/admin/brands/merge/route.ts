import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { mergeCanonicalBrands } from '@/lib/admin/approved-dnbrd-catalog'

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'brands:merge',
    limit: 20,
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
    const body = await request.json()
    const { sourceIds, targetId } = body

    if (!Array.isArray(sourceIds) || sourceIds.length === 0 || typeof targetId !== 'number') {
      return errorResponse({
        status: 400,
        code: 'INVALID_INPUT',
        message: 'sourceIds (array) and targetId (number) required.',
        context
      })
    }

    const result = await mergeCanonicalBrands(sourceIds, targetId)
    if (result.success) {
      return successResponse({ message: 'Markalar başarıyla birleştirildi.' }, context)
    } else {
      return errorResponse({
        status: 500,
        code: 'MERGE_FAILED',
        message: result.error || 'Birleştirme sırasında hata oluştu.',
        context
      })
    }
  } catch (error) {
    console.error('[brands:merge] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Birleştirme sırasında hata oluştu.',
      context
    })
  }
}
