import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  isProductListSupplier,
  parseSupplierProductId,
  unlinkSupplierRow
} from '@/lib/admin/product-manual-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:manual:unlink',
    limit: 120,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const body = await request.json().catch(() => ({}))
    if (!isProductListSupplier(body?.supplier)) {
      return errorResponse({ status: 400, code: 'INVALID_SUPPLIER', message: 'Geçersiz tedarikçi.', context })
    }
    const supplierProductId = parseSupplierProductId(body?.supplierProductId)
    if (supplierProductId == null) {
      return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçerli bir supplierProductId gerekli.', context })
    }

    const result = await unlinkSupplierRow({ supplier: body.supplier, supplierProductId })
    if (!result.ok) {
      return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Kaldırılacak eşleşme bulunamadı.', context })
    }
    return successResponse({ message: 'Eşleşme kaldırıldı.' }, context)
  } catch (error) {
    console.error('[eslestirme:products:manual:unlink] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Eşleşme kaldırılırken hata oluştu.',
      context
    })
  }
}
