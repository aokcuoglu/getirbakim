import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  isProductListSupplier,
  isProductSupplier,
  listManualMatchBrands,
  listUnlinkedRowsForBrand,
  parseSupplierProductId,
  searchSimilarCandidates
} from '@/lib/admin/product-manual-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Manuel eşleştirme çalışma alanı okuma uçları — tek GET, `view` ile dallanır:
 *   view=brands      → q?, limit?           marka seçicisi
 *   view=rows        → brandId, supplier?, q?, page?, limit?   bağlanmamış satırlar
 *   view=candidates  → supplier, supplierProductId, limit?     benzerlik adayları
 */
export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:manual',
    limit: 120,
    windowMs: 60_000
  })
  if (response) return response

  const sp = request.nextUrl.searchParams
  const view = sp.get('view') ?? 'brands'

  try {
    if (view === 'brands') {
      const q = sp.get('q') ?? undefined
      const limit = Math.min(Math.max(1, parseInt(sp.get('limit') ?? '1000', 10) || 1000), 2000)
      const withCounts = sp.get('lite') !== '1'
      const brands = await listManualMatchBrands(q, limit, withCounts)
      return successResponse({ brands }, context)
    }

    if (view === 'rows') {
      const brandId = parseInt(sp.get('brandId') ?? '', 10)
      if (isNaN(brandId)) {
        return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçerli bir brandId gerekli.', context })
      }
      const supplierRaw = sp.get('supplier')
      const supplier = isProductSupplier(supplierRaw) ? supplierRaw : undefined
      const q = sp.get('q') ?? undefined
      const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
      const limit = Math.min(Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50), 200)
      const result = await listUnlinkedRowsForBrand({ brandId, supplier, q, page, limit })
      return successResponse(result, context)
    }

    if (view === 'candidates') {
      const supplierRaw = sp.get('supplier')
      if (!isProductListSupplier(supplierRaw)) {
        return errorResponse({ status: 400, code: 'INVALID_SUPPLIER', message: 'Geçersiz tedarikçi.', context })
      }
      const supplierProductId = parseSupplierProductId(sp.get('supplierProductId'))
      if (supplierProductId == null) {
        return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçerli bir supplierProductId gerekli.', context })
      }
      const limit = Math.min(Math.max(1, parseInt(sp.get('limit') ?? '20', 10) || 20), 50)
      const result = await searchSimilarCandidates({ supplier: supplierRaw, supplierProductId, limit })
      return successResponse(result, context)
    }

    return errorResponse({ status: 400, code: 'INVALID_VIEW', message: `Geçersiz view: ${view}`, context })
  } catch (error) {
    console.error(`[eslestirme:products:manual:${view}] Error:`, error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Manuel eşleştirme verisi yüklenirken hata oluştu.',
      context
    })
  }
}
