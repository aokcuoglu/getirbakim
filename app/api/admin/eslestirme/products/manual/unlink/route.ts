import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import {
  isProductListSupplier,
  parseSupplierProductId,
  unlinkSupplierRow
} from '@/lib/admin/product-manual-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:manual:unlink',
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
