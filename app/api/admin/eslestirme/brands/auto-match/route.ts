import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
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
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:brands:auto-match',
    limit: 10,
    windowMs: 60_000
  })
  if (response) return response

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
