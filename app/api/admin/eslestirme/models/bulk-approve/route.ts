import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { approveDpmatchRows } from '@/lib/admin/dpprd-normalized'
import { ensureV0ProductFromProductMapping } from '@/lib/v0/product-code-signals'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:bulk-approve', limit: 10, windowMs: 120_000 })
  if (limitedResponse) return limitedResponse
  const auth = await getAdminAuth()
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  try {
    const body = await request.json()
    const ids: number[] = (body.ids || []).map((id: string | number) => Number(id)).filter((id: number) => !isNaN(id) && id > 0)
    if (ids.length === 0) return errorResponse({ status: 400, code: 'INVALID_INPUT', message: 'ids array is required.', context })
    if (ids.length > 500) return errorResponse({ status: 400, code: 'TOO_MANY', message: 'Maximum 500 IDs.', context })

    const approved = await approveDpmatchRows(ids, { onlyPending: true, matchMethod: 'MANUAL' })

    // Produce v0.products + product_sources + code_signals + public_part_links for each approved mapping
    let ensured = 0
    for (const id of ids) {
      try {
        const v0Id = await ensureV0ProductFromProductMapping(id)
        if (v0Id) ensured += 1
      } catch (e) {
        console.error(`[eslestirme:models:bulk-approve] ensureV0Product failed for mapping ${id}:`, e)
      }
    }

    return successResponse({ approved, ensured, message: `${approved} eşleştirme onaylandı, ${ensured} v0 ürün üretildi.` }, context)
  } catch (error) {
    console.error('[eslestirme:models:bulk-approve] Error:', error)
    return errorResponse({ status: 500, code: 'BULK_APPROVE_FAILED', message: 'Toplu onay başarısız.', context })
  }
}
