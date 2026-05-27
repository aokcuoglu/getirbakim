import { NextRequest } from 'next/server'
import { getDpmatchFilterOptions } from '@/lib/admin/dpmatch-filter-options'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'admin:catalog:products:options',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse
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
    const data = await getDpmatchFilterOptions()
    return successResponse(data, context)
  } catch (error) {
    console.error('[admin:catalog:products:options] Error:', error)
    return errorResponse({
      status: 500,
      code: 'ADMIN_CATALOG_PRODUCTS_OPTIONS_FAILED',
      message: 'Filtre seçenekleri yüklenemedi.',
      context
    })
  }
}
