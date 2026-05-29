import { NextRequest } from 'next/server'
import { listDpmatchForAdmin } from '@/lib/admin/dpprd-catalog'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'admin:catalog:products',
    limit: 180,
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
  const manufacturerIdStr = url.searchParams.get('manufacturerId')
  const manufacturerId = manufacturerIdStr
    ? parseInt(manufacturerIdStr, 10)
    : null
  const matchSide = url.searchParams.get('matchSide') ?? 'all'
  const mappingStatus = url.searchParams.get('mappingStatus') ?? 'all'
  const stockStatus = url.searchParams.get('stockStatus') ?? 'all'

  if (
    manufacturerIdStr &&
    (manufacturerId == null || Number.isNaN(manufacturerId) || manufacturerId <= 0)
  ) {
    return errorResponse({
      status: 400,
      code: 'INVALID_MANUFACTURER_ID',
      message: 'Geçersiz üretici ID.',
      context
    })
  }

  try {
    const data = await listDpmatchForAdmin({
      q: url.searchParams.get('q') ?? '',
      dinamikBrand: url.searchParams.get('dinamikBrand'),
      manufacturerId,
      matchSide:
        matchSide === 'matched' ||
        matchSide === 'unmatched' ||
        matchSide === 'dinamik_only' ||
        matchSide === 'pt_only'
          ? matchSide
          : 'all',
      mappingStatus:
        mappingStatus === 'APPROVED' ||
        mappingStatus === 'PENDING' ||
        mappingStatus === 'REJECTED' ||
        mappingStatus === 'IGNORED'
          ? mappingStatus
          : 'all',
      stockStatus:
        stockStatus === 'in_stock' ||
        stockStatus === 'low_stock' ||
        stockStatus === 'out_of_stock' ||
        stockStatus === 'zero_price'
          ? stockStatus
          : 'all',
      page: parseInt(url.searchParams.get('page') ?? '1', 10),
      limit: parseInt(url.searchParams.get('limit') ?? '50', 10),
      sort: url.searchParams.get('sort') ?? undefined,
      sortDir: url.searchParams.get('sort_dir')?.toLowerCase() === 'desc' ? 'desc' : 'asc'
    })
    return successResponse(data, context)
  } catch (error) {
    console.error('[admin:catalog:products] Error:', error)
    return errorResponse({
      status: 500,
      code: 'ADMIN_CATALOG_PRODUCTS_FAILED',
      message: 'Ürün eşleştirmeleri yüklenemedi.',
      context
    })
  }
}
