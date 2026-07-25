import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { revalidateAdminCatalogPaths } from '@/lib/admin/revalidate-catalog-paths'
import {
  ProductCsvImportError,
  runProductCsvImport,
  type ProductCsvImportMode
} from '@/lib/admin/product-list-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Dosya boyutu tavanı. 1M satırlık bir export satır başına ~300 bayttan
 * ~300 MB'a çıkabiliyor; formData tamamını belleğe aldığı için tavan buna göre.
 */
const MAX_BYTES = 512 * 1024 * 1024

/**
 * Düzenlenmiş CSV'yi geri yükler. İki modlu:
 *   - `validate` (varsayılan): hiçbir şey yazmaz, ne olacağını raporlar.
 *   - `apply`: planı uygular.
 */
export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:import',
    limit: 20,
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
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return errorResponse({
        status: 400,
        code: 'FILE_REQUIRED',
        message: 'CSV dosyası gönderilmedi.',
        context
      })
    }
    if (file.size > MAX_BYTES) {
      return errorResponse({
        status: 413,
        code: 'FILE_TOO_LARGE',
        message: `Dosya çok büyük (${Math.round(file.size / 1_048_576)} MB). En fazla ${MAX_BYTES / 1_048_576} MB.`,
        context
      })
    }

    const modeRaw = String(form.get('mode') ?? 'validate')
    const mode: ProductCsvImportMode = modeRaw === 'apply' ? 'apply' : 'validate'

    const result = await runProductCsvImport({
      text: await file.text(),
      mode,
      actor: auth.user.email ?? auth.user.id
    })

    if (mode === 'apply' && result.appliedRows > 0) revalidateAdminCatalogPaths()

    return successResponse(result, context)
  } catch (error) {
    if (error instanceof ProductCsvImportError) {
      return errorResponse({
        status: 400,
        code: 'CSV_INVALID',
        message: error.message,
        context
      })
    }
    console.error('[eslestirme:products:import] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'CSV içe aktarılırken hata oluştu.',
      context
    })
  }
}
