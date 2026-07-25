import { NextRequest } from 'next/server'
import { listApprovedDbrandsForAdmin } from '@/lib/admin/approved-dnbrd-catalog'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'admin:catalog:brands',
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

  const url = new URL(request.url)
  const logoStatus = url.searchParams.get('logoStatus') ?? 'all'
  const matchSide = url.searchParams.get('matchSide') ?? 'all'

  try {
    const data = await listApprovedDbrandsForAdmin({
      q: url.searchParams.get('q') ?? '',
      logoStatus:
        logoStatus === 'missing' || logoStatus === 'has_logo' ? logoStatus : 'all',
      matchSide:
        matchSide === 'matched' ||
        matchSide === 'dinamik_only' ||
        matchSide === 'basbug_only' ||
        matchSide === 'pending' ||
        matchSide === 'unmatched'
          ? matchSide
          : 'all',
      page: parseInt(url.searchParams.get('page') ?? '1', 10),
      limit: parseInt(url.searchParams.get('limit') ?? '50', 10),
      sort: url.searchParams.get('sort') ?? undefined,
      sortDir: url.searchParams.get('sort_dir')?.toLowerCase() === 'desc' ? 'desc' : 'asc'
    })
    return successResponse(data, context)
  } catch (error) {
    console.error('[admin:catalog:brands] Error:', error)
    return errorResponse({
      status: 500,
      code: 'ADMIN_CATALOG_BRANDS_FAILED',
      message: 'Onaylı markalar yüklenemedi.',
      context
    })
  }
}
