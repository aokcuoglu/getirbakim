import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:admin:dpmm:bulk-approve',
    limit: 10,
    windowMs: 120_000
  })
  if (limitedResponse) return limitedResponse

  const auth = await getAdminAuth()
  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  try {
    const body = await request.json()
    const ids: string[] = body.ids || []
    const minConfidence: number = body.minConfidence ?? 0.96

    if (!Array.isArray(ids) || ids.length === 0) {
      return errorResponse({ status: 400, code: 'INVALID_INPUT', message: 'ids array is required.', context })
    }

    if (ids.length > 500) {
      return errorResponse({ status: 400, code: 'TOO_MANY', message: 'Maximum 500 IDs per bulk operation.', context })
    }

    const adminUser = auth.user.email || auth.user.id
    const idBigInts = ids.map((id: string) => {
      try { return BigInt(id) } catch { return BigInt(0) }
    }).filter((id: bigint) => id > BigInt(0))

    if (idBigInts.length === 0) {
      return errorResponse({ status: 400, code: 'INVALID_INPUT', message: 'No valid IDs provided.', context })
    }

    const result = await db.$executeRaw(Prisma.sql`
      UPDATE public.dinamik_parcatedarik_model_matches
      SET status = 'APPROVED',
          approved_by = ${adminUser},
          approved_at = NOW(),
          updated_at = NOW()
      WHERE id IN (${Prisma.join(idBigInts)})
        AND status = 'CANDIDATE'
        AND match_reason NOT LIKE 'MULTIPLE%'
        AND confidence >= ${minConfidence}
    `)

    return successResponse({
      action: 'bulk_approve',
      updatedCount: result,
      minConfidence
    }, context)
  } catch (error) {
    console.error('Error in POST /api/admin/supplier-matching/dinamik-parcatedarik/bulk-approve:', error)
    return errorResponse({ status: 500, code: 'BULK_APPROVE_FAILED', message: 'Failed to bulk approve matches.', context })
  }
}