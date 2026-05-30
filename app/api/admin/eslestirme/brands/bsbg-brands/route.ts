import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:brands:bsbg-search',
    limit: 200,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)), 100)

  try {
    if (!q) return successResponse([], context)
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    const results = await db.$queryRaw<Array<{ id: number; name: string }>>(
      Prisma.sql`SELECT id::int AS id, brand AS name FROM v0.bsbg_brands WHERE brand ILIKE ${pattern} ORDER BY brand ASC LIMIT ${limit}`
    )
    return successResponse(results, context)
  } catch (error) {
    console.error('[eslestirme:brands:bsbg-search] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Başbuğ marka arama sırasında hata oluştu.', context })
  }
}