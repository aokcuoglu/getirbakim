import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { autoMatchExactBrands } from '@/lib/admin/supplier-brand-match'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Grup sayısıyla ölçeklenen çoklu-transaction işi; ağır çalışmaya karşı 5 dk.
export const maxDuration = 300

/**
 * Birebir (kelimesi kelimesine) otomatik marka eşleştirme.
 *
 * Dinamik / Başbuğ markalarından adı birebir aynı olanları tek
 * kanonik markaya bağlar. Bkz. `autoMatchExactBrands`.
 */
export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:brands:auto-match',
    limit: 10,
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
    const result = await autoMatchExactBrands()
    return successResponse(result, context)
  } catch (error) {
    console.error('[eslestirme:brands:auto-match] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Otomatik marka eşleştirme çalıştırılırken hata oluştu.',
      context
    })
  }
}
