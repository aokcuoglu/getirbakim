import { NextRequest } from 'next/server'
import { getAdminProductDetail } from '@/lib/actions/admin-products'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'

export async function GET(
  request: NextRequest,
  contextInput: { params: Promise<{ id: string }> }
) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'api:admin-product-detail',
    limit: 180,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const { id } = await contextInput.params
    const start = performance.now()
    const result = await getAdminProductDetail(id)
    if (!result.success || !result.data) {
      return errorResponse({
        status: 404,
        code: 'ADMIN_PRODUCT_NOT_FOUND',
        message: result.message || 'Product detail not found.',
        context
      })
    }

    const okResponse = successResponse(result.data, context)
    okResponse.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return okResponse
  } catch (error) {
    console.error('Error in /api/admin/products/[id]/detail:', error)
    return errorResponse({
      status: 500,
      code: 'ADMIN_PRODUCT_DETAIL_FAILED',
      message: 'Admin product detail lookup failed.',
      context
    })
  }
}
