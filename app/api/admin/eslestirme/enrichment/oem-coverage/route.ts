import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
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
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:enrichment:oem-coverage',
    limit: 60,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      context
    })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({
      status: 403,
      code: 'ADMIN_REQUIRED',
      message: 'Admin access required.',
      context
    })
  }

  try {
    const fresh = request.nextUrl.searchParams.get('fresh') === '1'
    return successResponse({ rows: await getOemBrandCoverageRows({ fresh }) }, context)
  } catch (error) {
    console.error('[eslestirme:enrichment:oem-coverage] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Kaynak kapsamı yüklenirken hata oluştu.',
      context
    })
  }
}
