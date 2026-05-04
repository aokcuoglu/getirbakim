import { NextRequest } from 'next/server'
import { getAdminProductsWorkbench } from '@/lib/actions/admin-products'
import { parseAdminProductsUrlState } from '@/lib/admin-products-workbench'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin-products-workbench',
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
    const { filters } = parseAdminProductsUrlState(request.nextUrl.searchParams)
    const start = performance.now()
    const data = await getAdminProductsWorkbench(filters)
    const response = successResponse(data, context)
    response.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return response
  } catch (error) {
    console.error('Error in /api/admin/products/workbench:', error)
    return errorResponse({
      status: 500,
      code: 'ADMIN_PRODUCTS_WORKBENCH_FAILED',
      message: 'Admin products workbench lookup failed.',
      context
    })
  }
}
