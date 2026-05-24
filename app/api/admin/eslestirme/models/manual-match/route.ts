import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

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

    // If matchId is given, simply approve it
    if (matchId) {
      const match = await db.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM parcatedarik.dpmatch WHERE id = ${matchId}`
      )
      if (!match || match.length === 0) return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Eşleştirme bulunamadı.', context })

      await db.$executeRaw(Prisma.sql`UPDATE parcatedarik.dpmatch SET mapping_status = 'APPROVED', match_method = 'MANUAL' WHERE id = ${matchId}`)
      return successResponse({ message: 'Eşleştirme onaylandı.', id: matchId }, context)
    }

    // If dproductsId and productId given, create or update a match
    if (dproductsId && productId) {
      const exists = await db.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM parcatedarik.dpmatch WHERE dproducts_id = ${dproductsId} AND product_id = ${productId}`
      )

      if (exists && exists.length > 0) {
        await db.$executeRaw(Prisma.sql`UPDATE parcatedarik.dpmatch SET mapping_status = 'APPROVED', match_method = 'MANUAL' WHERE id = ${exists[0].id}`)
        return successResponse({ message: 'Eşleştirme onaylandı.', id: exists[0].id }, context)
      }

      await db.$executeRaw(Prisma.sql`INSERT INTO parcatedarik.dpmatch (dproducts_id, product_id, mapping_status, match_method) VALUES (${dproductsId}, ${productId}, 'APPROVED', 'MANUAL')`)
      return successResponse({ message: 'Manuel eşleştirme oluşturuldu.', id: null }, context)
    }

    return errorResponse({ status: 400, code: 'MISSING_INPUT', message: 'matchId veya (dproductsId + productId) gerekli.', context })
  } catch (error) {
    console.error('[eslestirme:models:manual-match] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Manuel eşleştirme sırasında hata oluştu.', context })
  }
}
