import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

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

    const result = await db.$executeRaw(
      Prisma.sql`UPDATE parcatedarik.dpmatch SET mapping_status = 'APPROVED' WHERE id IN (${Prisma.join(ids)}) AND mapping_status = 'PENDING'`
    )
    return successResponse({ approved: result, message: `${result} eşleştirme onaylandı.` }, context)
  } catch (error) {
    console.error('[eslestirme:models:bulk-approve] Error:', error)
    return errorResponse({ status: 500, code: 'BULK_APPROVE_FAILED', message: 'Toplu onay başarısız.', context })
  }
}
