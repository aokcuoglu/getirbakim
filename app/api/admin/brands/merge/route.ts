import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import { mergeCanonicalBrands } from '@/lib/admin/approved-dnbrd-catalog'

export async function POST(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'brands:merge',
    limit: 20,
    windowMs: 60_000
  })
  if (response) return response

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
