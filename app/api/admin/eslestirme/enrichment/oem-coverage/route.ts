import { NextRequest } from 'next/server'
import { requireAdmin, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { getOemBrandCoverageRows } from '@/lib/admin/oem-brand-coverage'

/**
 * Marka bazında OEM kaynak kapsamı — gerekçesi kardeş `coverage` route'uyla
 * aynı: önbelleğin tutması ve panellerin paralel yüklenmesi için GET.
 *
 * Tüm markalar tek seferde döner (~630 satır); filtre/arama istemcide.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:enrichment:oem-coverage',
    limit: 60,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const fresh = request.nextUrl.searchParams.get('fresh') === '1'
    return successResponse({ rows: await getOemBrandCoverageRows({ fresh }) }, context)
  } catch (error) {
    console.error('[eslestirme:enrichment:oem-coverage] Error:', error)
    return unexpectedErrorResponse(error, context, 'Kaynak kapsamı yüklenirken hata oluştu.')
  }
}
