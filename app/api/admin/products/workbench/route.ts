import { NextRequest } from 'next/server'
import { getAdminProductsWorkbench } from '@/lib/actions/admin-products'
import { parseAdminProductsUrlState } from '@/lib/admin-products-workbench'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'api:admin-products-workbench',
    limit: 180,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const { filters } = parseAdminProductsUrlState(request.nextUrl.searchParams)
    const start = performance.now()
    const data = await getAdminProductsWorkbench(filters)
    const okResponse = successResponse(data, context)
    okResponse.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return okResponse
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
