import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { isSupplierKey, searchBrandCandidates } from '@/lib/admin/supplier-brand-match'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:candidates',
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

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const excludeSupplierRaw = url.searchParams.get('excludeSupplier') ?? ''
  const excludeId = url.searchParams.get('excludeId') ?? undefined
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 100)

  const excludeSupplier = isSupplierKey(excludeSupplierRaw) ? excludeSupplierRaw : undefined

  try {
    const candidates = await searchBrandCandidates({
      q,
      excludeSupplier,
      excludeId: excludeId || undefined,
      limit
    })
    return successResponse({ candidates }, context)
  } catch (error) {
    console.error('[eslestirme:candidates] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Adaylar yüklenirken hata oluştu.',
      context
    })
  }
}
