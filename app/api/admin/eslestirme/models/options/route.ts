import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:models:options',
    limit: 60,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  try {
    const [brandRows, manufacturerRows] = await Promise.all([
      db.$queryRaw<Array<{ brand: string }>>(Prisma.sql`
        SELECT DISTINCT BTRIM(d.brand) AS brand
        FROM parcatedarik.dpmatch m
        INNER JOIN parcatedarik.dproducts d ON d.id = m.dproducts_id
        WHERE d.brand IS NOT NULL AND BTRIM(d.brand) <> ''
        ORDER BY brand ASC
      `),
      db.$queryRaw<Array<{ id: number; name: string }>>(Prisma.sql`
        SELECT DISTINCT mfr.id, mfr.name
        FROM parcatedarik.dpmatch m
        INNER JOIN parcatedarik.product p ON p.id = m.product_id
        INNER JOIN parcatedarik.manufacturer mfr ON mfr.id = p.manufacturer_id
        ORDER BY mfr.name ASC
      `),
    ])

    return successResponse({
      dinamikBrands: brandRows.map((row) => row.brand),
      manufacturers: manufacturerRows,
    }, context)
  } catch (error) {
    console.error('[eslestirme:models:options] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Filtre seçenekleri yüklenemedi.', context })
  }
}
