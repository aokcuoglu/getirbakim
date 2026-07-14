import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import {
  deleteBrandMapping,
  isSupplierKey,
  linkSupplierBrandToCanonical,
  parseSupplierBrandId,
  setBrandMappingStatus
} from '@/lib/admin/supplier-brand-match'

const VALID_ACTIONS = ['link', 'unlink', 'approve', 'reject', 'ignore'] as const

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:brands:action',
    limit: 100,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  const { action } = await params
  if (!VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
    return errorResponse({
      status: 400,
      code: 'INVALID_ACTION',
      message: `Geçersiz işlem: ${action}. İzin verilenler: ${VALID_ACTIONS.join(', ')}`,
      context
    })
  }

  try {
    const body = await request.json().catch(() => ({}))

    // Durum aksiyonları — mevcut mapping id üzerinde çalışır.
    if (action === 'approve' || action === 'reject' || action === 'ignore') {
      const mappingId = parseInt(String(body?.mappingId), 10)
      if (isNaN(mappingId)) {
        return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçerli bir mappingId gerekli.', context })
      }
      const statusMap = { approve: 'APPROVED', reject: 'REJECTED', ignore: 'IGNORED' } as const
      const ok = await setBrandMappingStatus(mappingId, statusMap[action])
      if (!ok) {
        return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Eşleştirme bulunamadı.', context })
      }
      const msg = {
        approve: 'Marka eşleştirmesi onaylandı.',
        reject: 'Marka eşleştirmesi reddedildi.',
        ignore: 'Marka eşleştirmesi yoksayıldı.'
      }[action]
      return successResponse({ mappingId, action, message: msg }, context)
    }

    if (action === 'unlink') {
      const mappingId = parseInt(String(body?.mappingId), 10)
      if (isNaN(mappingId)) {
        return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçerli bir mappingId gerekli.', context })
      }
      const ok = await deleteBrandMapping(mappingId)
      if (!ok) {
        return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Eşleştirme bulunamadı.', context })
      }
      return successResponse({ mappingId, action, message: 'Marka eşleştirmesi kaldırıldı.' }, context)
    }

    // link — tedarikçi markasını kanonik markaya bağla.
    const supplier = String(body?.supplier ?? '')
    if (!isSupplierKey(supplier)) {
      return errorResponse({ status: 400, code: 'INVALID_SUPPLIER', message: 'Geçersiz tedarikçi.', context })
    }
    const rawSupplierBrandId = body?.supplierBrandId
    if (rawSupplierBrandId == null || String(rawSupplierBrandId).trim() === '') {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'supplierBrandId gerekli.', context })
    }

    const canonicalBrandId =
      body?.canonicalBrandId != null && String(body.canonicalBrandId).trim() !== ''
        ? parseInt(String(body.canonicalBrandId), 10)
        : undefined
    const newBrandName =
      typeof body?.newBrandName === 'string' ? body.newBrandName : undefined

    // Hedef başka bir tedarikçi markası olabilir.
    const targetSupplierRaw = body?.targetSupplier
    const targetSupplier =
      typeof targetSupplierRaw === 'string' && isSupplierKey(targetSupplierRaw)
        ? targetSupplierRaw
        : undefined
    const hasTarget = targetSupplier != null && body?.targetSupplierBrandId != null

    if (canonicalBrandId == null && !newBrandName?.trim() && !hasTarget) {
      return errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'canonicalBrandId, targetSupplier veya newBrandName gerekli.',
        context
      })
    }

    let supplierBrandId: bigint | number
    let targetSupplierBrandId: bigint | number | undefined
    try {
      supplierBrandId = parseSupplierBrandId(supplier, rawSupplierBrandId)
      if (hasTarget) {
        targetSupplierBrandId = parseSupplierBrandId(targetSupplier, body.targetSupplierBrandId)
      }
    } catch {
      return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçersiz marka id.', context })
    }

    const result = await linkSupplierBrandToCanonical({
      supplier,
      supplierBrandId,
      canonicalBrandId,
      targetSupplier,
      targetSupplierBrandId,
      newBrandName
    })

    if (!result.success) {
      return errorResponse({
        status: 400,
        code: 'LINK_FAILED',
        message: result.error ?? 'Eşleştirme kaydedilemedi.',
        context
      })
    }

    return successResponse(
      { action, canonicalId: result.canonicalId, message: 'Marka eşleştirmesi kaydedildi.' },
      context
    )
  } catch (error) {
    console.error(`[eslestirme:brands:${action}] Error:`, error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'İşlem sırasında hata oluştu.',
      context
    })
  }
}
