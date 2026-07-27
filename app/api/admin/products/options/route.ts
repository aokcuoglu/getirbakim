import { NextRequest } from 'next/server'
import { getAdminProductOptions } from '@/lib/actions/admin-products'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'api:admin-products-options',
    limit: 180,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const start = performance.now()
    const data = await getAdminProductOptions()
    const okResponse = successResponse(data, context)
    okResponse.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return okResponse
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
