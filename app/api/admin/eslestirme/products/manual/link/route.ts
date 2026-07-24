import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import {
  isProductListSupplier,
  manualLinkSupplierRow,
  parseSupplierProductId
} from '@/lib/admin/product-manual-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REASON_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Tedarikçi satırı bulunamadı.',
  BRAND_MISMATCH: 'Seçilen ürün, tedarikçi satırının markasıyla eşleşmiyor.',
  ALREADY_LINKED: 'Bu tedarikçi satırı zaten bir offer\'a bağlı.',
  SUPPLIER_CONFLICT: 'Hedef ürünün bu tedarikçiden zaten bir offer\'ı var.'
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:manual:link',
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
    const productId = parseSupplierProductId(body?.productId)
    if (productId == null) {
      return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçerli bir productId gerekli.', context })
    }

    const reviewedBy = auth.user.email ?? auth.user.id ?? null
    const result = await manualLinkSupplierRow({
      supplier: body.supplier,
      supplierProductId,
      productId,
      reviewedBy
    })

    if (!result.ok) {
      return errorResponse({
        status: result.reason === 'NOT_FOUND' ? 404 : 409,
        code: result.reason,
        message: REASON_MESSAGES[result.reason] ?? 'Eşleştirme yapılamadı.',
        context
      })
    }

    return successResponse(
      { productId: result.productId, message: 'Ürün eşleştirildi, offer oluşturuldu.' },
      context
    )
  } catch (error) {
    console.error('[eslestirme:products:manual:link] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Eşleştirme sırasında hata oluştu.',
      context
    })
  }
}
