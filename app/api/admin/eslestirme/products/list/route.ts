import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  isProductListCoverage,
  isProductListOem,
  isProductListStatus,
  isProductListSupplierFilter,
  listSupplierProductsTable
} from '@/lib/admin/product-list'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:list',
    limit: 120,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const sp = request.nextUrl.searchParams
    const supplierRaw = sp.get('supplier') ?? 'dinamik'
    const supplier = isProductListSupplierFilter(supplierRaw) ? supplierRaw : 'dinamik'
    const statusRaw = sp.get('status') ?? 'all'
    const status = isProductListStatus(statusRaw) ? statusRaw : 'all'
    const coverageRaw = sp.get('coverage') ?? 'all'
    const coverage = isProductListCoverage(coverageRaw) ? coverageRaw : 'all'
    const oemRaw = sp.get('oem') ?? 'all'
    const oem = isProductListOem(oemRaw) ? oemRaw : 'all'
    const q = sp.get('q') ?? undefined
    const brandIdRaw = parseInt(sp.get('brandId') ?? '', 10)
    const brandId = Number.isNaN(brandIdRaw) ? undefined : brandIdRaw
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50), 200)

    const result = await listSupplierProductsTable({
      supplier,
      status,
      coverage,
      oem,
      q,
      brandId,
      page,
      limit
    })
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
