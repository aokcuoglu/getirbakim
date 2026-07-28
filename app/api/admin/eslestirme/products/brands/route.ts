import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  isProductListCoverage,
  isProductListOem,
  isProductListStatus,
  isProductListSupplierFilter,
  listProductListBrandOptions
} from '@/lib/admin/product-list'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ürün listesindeki "Marka filtrele" seçicisinin seçenekleri.
 *
 * Tablo ile AYNI filtre parametrelerini alır (supplier/status/coverage/oem/q);
 * `brandId` yok sayılır, üretilen şey odur. Marka adında arama `brandQ` ile
 * yapılır — `q` tablodaki ürün aramasıdır ve olduğu gibi uygulanır.
 */
export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:brands',
    limit: 120,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const sp = request.nextUrl.searchParams
    const supplierRaw = sp.get('supplier') ?? 'all'
    const statusRaw = sp.get('status') ?? 'all'
    const coverageRaw = sp.get('coverage') ?? 'all'
    const oemRaw = sp.get('oem') ?? 'all'
    const limit = Math.min(Math.max(1, parseInt(sp.get('limit') ?? '1000', 10) || 1000), 2000)

    const brands = await listProductListBrandOptions({
      supplier: isProductListSupplierFilter(supplierRaw) ? supplierRaw : 'all',
      status: isProductListStatus(statusRaw) ? statusRaw : 'all',
      coverage: isProductListCoverage(coverageRaw) ? coverageRaw : 'all',
      oem: isProductListOem(oemRaw) ? oemRaw : 'all',
      q: sp.get('q') ?? undefined,
      brandQ: sp.get('brandQ') ?? undefined,
      limit
    })
    return successResponse({ brands }, context)
  } catch (error) {
    console.error('[eslestirme:products:brands] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Marka listesi yüklenirken hata oluştu.',
      context
    })
  }
}
