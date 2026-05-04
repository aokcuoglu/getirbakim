import { NextRequest } from 'next/server'
import { getAdminProductOptions } from '@/lib/actions/admin-products'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin-products-options',
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
    const start = performance.now()
    const data = await getAdminProductOptions()
    const response = successResponse(data, context)
    response.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return response
  } catch (error) {
    console.error('Error in /api/admin/products/options:', error)
    return errorResponse({
      status: 500,
      code: 'ADMIN_PRODUCTS_OPTIONS_FAILED',
      message: 'Admin product options lookup failed.',
      context
    })
  }
}
