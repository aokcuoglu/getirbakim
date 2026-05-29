import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:brands:options',
    limit: 60,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) {
    return errorResponse({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      context,
    })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({
      status: 403,
      code: 'ADMIN_REQUIRED',
      message: 'Admin access required.',
      context,
    })
  }

  try {
    const [brandRows, manufacturerRows] = await Promise.all([
      db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
        SELECT DISTINCT BTRIM(brand) AS brand
        FROM v0.dnmk_brands
        WHERE brand IS NOT NULL AND BTRIM(brand) <> ''
        ORDER BY brand ASC
      `),
      db.$queryRaw<Array<{ id: number; name: string }>>(Prisma.sql`
        SELECT DISTINCT pt.id, pt.name
        FROM v0.dnmk_ptdrk_brand_mappings m
        INNER JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
        ORDER BY pt.name ASC
      `),
    ])

    return successResponse(
      {
        dinamikBrands: brandRows.map((row) => row.brand),
        manufacturers: manufacturerRows,
      },
      context
    )
  } catch (error) {
    console.error('[eslestirme:brands:options] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Filtre seçenekleri yüklenemedi.',
      context,
    })
  }
}
