import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:action', limit: 60, windowMs: 60_000 })
  if (limitedResponse) return limitedResponse
  const auth = await getAdminAuth()
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const pathParts = new URL(request.url).pathname.split('/')
  const actionStr = pathParts[pathParts.length - 1]
  const idStr = pathParts[pathParts.length - 2]
  if (!idStr || !actionStr) return errorResponse({ status: 400, code: 'INVALID_REQUEST', message: 'Missing match ID or action.', context })

  const matchId = parseInt(idStr, 10)
  if (isNaN(matchId) || matchId <= 0) return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Invalid match ID.', context })

  const validActions = ['approve', 'reject', 'ignore', 'unmatch'] as const
  type MatchAction = (typeof validActions)[number]
  const action = validActions.find(a => a === actionStr) as MatchAction | undefined
  if (!action) return errorResponse({ status: 400, code: 'INVALID_ACTION', message: `Invalid action: ${actionStr}`, context })

  try {
    const match = await db.$queryRaw<Array<{ id: number; mapping_status: string }>>(
      Prisma.sql`SELECT id, mapping_status FROM parcatedarik.dpmatch WHERE id = ${matchId}`
    )
    if (!match || match.length === 0) return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Eşleştirme bulunamadı.', context })

    if (action === 'approve') {
      await db.$executeRaw(Prisma.sql`UPDATE parcatedarik.dpmatch SET mapping_status = 'APPROVED' WHERE id = ${matchId}`)
      return successResponse({ id: matchId, action: 'approved', message: 'Eşleştirme onaylandı.' }, context)
    }
    if (action === 'reject') {
      await db.$executeRaw(Prisma.sql`UPDATE parcatedarik.dpmatch SET mapping_status = 'REJECTED' WHERE id = ${matchId}`)
      return successResponse({ id: matchId, action: 'rejected', message: 'Eşleştirme reddedildi.' }, context)
    }
    if (action === 'ignore') {
      await db.$executeRaw(Prisma.sql`UPDATE parcatedarik.dpmatch SET mapping_status = 'IGNORED' WHERE id = ${matchId}`)
      return successResponse({ id: matchId, action: 'ignored', message: 'Eşleştirme yoksayıldı.' }, context)
    }
    if (action === 'unmatch') {
      await db.$executeRaw(Prisma.sql`UPDATE parcatedarik.dpmatch SET mapping_status = 'PENDING', match_method = NULL, normalized = NULL WHERE id = ${matchId}`)
      return successResponse({ id: matchId, action: 'unmatched', message: 'Eşleştirme sıfırlandı.' }, context)
    }

    return errorResponse({ status: 400, code: 'INVALID_ACTION', message: 'Unhandled action.', context })
  } catch (error) {
    console.error(`[eslestirme:models:${actionStr}] Error:`, error)
    return errorResponse({ status: 500, code: 'ACTION_FAILED', message: `İşlem başarısız: ${actionStr}`, context })
  }
}
