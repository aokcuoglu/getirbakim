import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { approveDpmatchRows } from '@/lib/admin/dpmatch-normalized'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { linkDpmatchPair } from '@/lib/admin/dpmatch-link'

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:manual-match', limit: 50, windowMs: 60_000 })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  try {
    const body = await request.json()
    const matchId = body.matchId ? parseInt(String(body.matchId), 10) : null
    const dproductsId = body.dproductsId ? BigInt(String(body.dproductsId)) : null
    const productId = body.productId ? Number(body.productId) : null

    if (matchId && isNaN(matchId)) return errorResponse({ status: 400, code: 'INVALID_INPUT', message: 'Geçersiz eşleşme ID.', context })

    if (matchId) {
      const match = await db.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM v0.dpmatch WHERE id = ${matchId}`
      )
      if (!match || match.length === 0) return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Eşleştirme bulunamadı.', context })

      await approveDpmatchRows([matchId], { matchMethod: 'MANUAL' })
      return successResponse({ message: 'Eşleştirme onaylandı.', id: matchId }, context)
    }

    if (dproductsId && productId) {
      const result = await linkDpmatchPair({
        dproductsId,
        productId,
        mappingStatus: 'APPROVED',
        matchMethod: 'MANUAL',
      })

      const message = result.action === 'updated'
        ? 'Eşleştirme güncellendi.'
        : 'Manuel eşleştirme oluşturuldu.'

      return successResponse({ message, id: result.id }, context)
    }

    return errorResponse({ status: 400, code: 'MISSING_INPUT', message: 'matchId veya (dproductsId + productId) gerekli.', context })
  } catch (error) {
    console.error('[eslestirme:models:manual-match] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Manuel eşleştirme sırasında hata oluştu.', context })
  }
}
