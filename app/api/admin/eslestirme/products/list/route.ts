import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import {
  isProductListCoverage,
  isProductListStatus,
  isProductListSupplier,
  listSupplierProductsTable
} from '@/lib/admin/product-list'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:list',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  try {
    const sp = request.nextUrl.searchParams
    const supplierRaw = sp.get('supplier') ?? 'dinamik'
    const supplier = isProductListSupplier(supplierRaw) ? supplierRaw : 'dinamik'
    const statusRaw = sp.get('status') ?? 'all'
    const status = isProductListStatus(statusRaw) ? statusRaw : 'all'
    const coverageRaw = sp.get('coverage') ?? 'all'
    const coverage = isProductListCoverage(coverageRaw) ? coverageRaw : 'all'
    const q = sp.get('q') ?? undefined
    const brandIdRaw = parseInt(sp.get('brandId') ?? '', 10)
    const brandId = Number.isNaN(brandIdRaw) ? undefined : brandIdRaw
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50), 200)

    const result = await listSupplierProductsTable({ supplier, status, coverage, q, brandId, page, limit })
    return successResponse(result, context)
  } catch (error) {
    console.error('[eslestirme:products:list] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Ürün listesi yüklenirken hata oluştu.',
      context
    })
  }
}
