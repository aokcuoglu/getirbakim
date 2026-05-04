import { NextRequest } from 'next/server'
import { getAdminProductDetail } from '@/lib/actions/admin-products'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

export async function GET(
  request: NextRequest,
  contextInput: { params: Promise<{ id: string }> }
) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin-product-detail',
    limit: 180,
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

    const response = successResponse(result.data, context)
    response.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return response
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
