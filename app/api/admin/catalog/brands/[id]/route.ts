import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import { revalidateAdminCatalogPaths } from '@/lib/admin/revalidate-catalog-paths'
import {
  deleteCanonicalBrand,
  updateCanonicalBrandName
} from '@/lib/admin/approved-dnbrd-catalog'

function parseId(idStr: string): number | null {
  const id = parseInt(idStr, 10)
  if (Number.isNaN(id) || id <= 0) return null
  return id
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'admin:catalog:brands:update',
    limit: 60,
    windowMs: 60_000
  })
  if (response) return response

  const { id: idStr } = await params
  const id = parseId(idStr)
  if (id == null) {
    return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçersiz marka ID.', context })
  }

  const body = await request.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name : ''
  if (!name.trim()) {
    return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Marka adı gerekli.', context })
  }

  const result = await updateCanonicalBrandName(id, name)
  if (!result.success) {
    const status = result.error?.includes('zaten var') ? 409 : result.error?.includes('bulunamadı') ? 404 : 400
    return errorResponse({
      status,
      code: status === 409 ? 'DUPLICATE' : status === 404 ? 'NOT_FOUND' : 'UPDATE_FAILED',
      message: result.error ?? 'Marka adı güncellenemedi.',
      context
    })
  }

  revalidateAdminCatalogPaths()
  return successResponse({ id, name: name.trim(), message: 'Marka adı güncellendi.' }, context)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'admin:catalog:brands:delete',
    limit: 30,
    windowMs: 60_000
  })
  if (response) return response

  const { id: idStr } = await params
  const id = parseId(idStr)
  if (id == null) {
    return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçersiz marka ID.', context })
  }

  const result = await deleteCanonicalBrand(id)
  if (!result.success) {
    const status = result.error?.includes('bulunamadı') ? 404 : 409
    return errorResponse({
      status,
      code: status === 404 ? 'NOT_FOUND' : 'DELETE_BLOCKED',
      message: result.error ?? 'Marka silinemedi.',
      context
    })
  }

  revalidateAdminCatalogPaths()
  return successResponse({ id, message: 'Marka silindi.' }, context)
}
