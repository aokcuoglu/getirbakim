import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(_request, {
    keyPrefix: 'eslestirme:brands:detail',
    limit: 120,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçersiz ID.', context })

  try {
    const brand = await db.$queryRaw<Array<{ id: number; brand: string; logo_url: string | null }>>(
      Prisma.sql`SELECT id, brand, logo_url FROM v0.brand_list WHERE id = ${id}`
    )
    if (!brand || brand.length === 0) {
      return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Marka bulunamadı.', context })
    }

    const mappings = await db.$queryRaw<
      Array<{
        id: number
        dnmk_brand: string | null
        pt_name: string | null
        bsbg_brand: string | null
        mapping_status: string
      }>
    >(
      Prisma.sql`
        SELECT
          bm.id,
          db.brand AS dnmk_brand,
          pb.name AS pt_name,
          bb.brand AS bsbg_brand,
          bm.mapping_status
        FROM v0.brand_mappings bm
        LEFT JOIN v0.dnmk_brands db ON db.id = bm.dnmk_brands_id
        LEFT JOIN v0.ptdrk_brands pb ON pb.id = bm.ptdrk_brands_id
        LEFT JOIN v0.bsbg_brands bb ON bb.id = bm.bsbg_brands_id
        WHERE bm.brand_list_id = ${id}
        ORDER BY bm.id
      `
    )

    return successResponse({
      id: brand[0].id,
      brand: brand[0].brand,
      logo_url: brand[0].logo_url,
      mappings,
    }, context)
  } catch (error) {
    console.error('[eslestirme:brands:detail] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Marka bilgisi yüklenemedi.', context })
  }
}
