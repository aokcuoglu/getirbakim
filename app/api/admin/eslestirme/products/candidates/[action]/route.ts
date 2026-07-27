import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  approveProductMatchCandidate,
  parseCandidateId,
  rejectProductMatchCandidate
} from '@/lib/admin/product-match-candidates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_ACTIONS = ['approve', 'reject'] as const

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const { response, context, auth } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:products:candidates:action',
    limit: 100,
    windowMs: 60_000
  })
  if (response) return response

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
    const candidateId = parseCandidateId(body?.candidateId)
    if (candidateId == null) {
      return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçerli bir candidateId gerekli.', context })
    }

    const reviewedBy = auth.user.email ?? auth.user.id ?? null

    if (action === 'approve') {
      const result = await approveProductMatchCandidate(candidateId, reviewedBy)
      if (!result.ok) {
        return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Aday bulunamadı veya zaten işlenmiş.', context })
      }
      return successResponse(
        { action, candidateId: candidateId.toString(), productId: result.productId, message: 'Eşleştirme onaylandı, offer oluşturuldu.' },
        context
      )
    }

    // reject
    const result = await rejectProductMatchCandidate(candidateId, reviewedBy)
    if (!result.ok) {
      return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Aday bulunamadı veya zaten işlenmiş.', context })
    }
    return successResponse(
      { action, candidateId: candidateId.toString(), message: 'Aday reddedildi.' },
      context
    )
  } catch (error) {
    console.error(`[eslestirme:products:candidates:${action}] Error:`, error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'İşlem sırasında hata oluştu.',
      context
    })
  }
}
