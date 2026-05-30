import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normalizeModel } from '@/lib/matching/code-normalization'

const VALID_ACTIONS = ['approve', 'reject', 'ignore', 'update', 'delete'] as const

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'brand-aliases:action',
    limit: 100,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  const { id: idStr, action } = await params
  const id = parseInt(idStr, 10)

  if (isNaN(id)) {
    return errorResponse({
      status: 400,
      code: 'INVALID_ID',
      message: 'Geçersiz ID.',
      context
    })
  }

  if (!VALID_ACTIONS.includes(action as any)) {
    return errorResponse({
      status: 400,
      code: 'INVALID_ACTION',
      message: `Geçersiz işlem: ${action}. İzin verilenler: ${VALID_ACTIONS.join(', ')}`,
      context
    })
  }

  try {
    const body = await request.json().catch(() => ({}))

    switch (action) {
      case 'approve': {
        await db.$executeRaw(
          Prisma.sql`UPDATE v0.brand_mappings
            SET mapping_status = 'APPROVED'
            WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi onaylandı.' }, context)
      }

      case 'reject': {
        await db.$executeRaw(
          Prisma.sql`UPDATE v0.brand_mappings
            SET mapping_status = 'REJECTED'
            WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi reddedildi.' }, context)
      }

      case 'ignore': {
        await db.$executeRaw(
          Prisma.sql`UPDATE v0.brand_mappings
            SET mapping_status = 'IGNORED'
            WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi yoksayıldı.' }, context)
      }

      case 'update': {
        const parcatedarikManufacturerId = body?.parcatedarikManufacturerId
        if (!parcatedarikManufacturerId || isNaN(parseInt(String(parcatedarikManufacturerId), 10))) {
          return errorResponse({
            status: 400,
            code: 'VALIDATION_ERROR',
            message: 'parcatedarikManufacturerId gerekli.',
            context
          })
        }

        const mfrId = parseInt(String(parcatedarikManufacturerId), 10)
        const manufacturer = await db.$queryRaw<
          Array<{ id: number; name: string }>
        >(Prisma.sql`SELECT id, name FROM v0.ptdrk_brands WHERE id = ${mfrId}`)

        if (!manufacturer || manufacturer.length === 0) {
          return errorResponse({
            status: 404,
            code: 'NOT_FOUND',
            message: 'Üretici bulunamadı.',
            context
          })
        }

        const mfrName = manufacturer[0].name
        const normalized = normalizeModel(mfrName) || ''

        await db.$executeRaw(
          Prisma.sql`
            WITH canonical AS (
              INSERT INTO v0.brand_list (normalized_brand)
              VALUES (${normalized})
              ON CONFLICT (normalized_brand) DO UPDATE SET normalized_brand = ${normalized}
              RETURNING id
            )
            UPDATE v0.brand_mappings
              SET ptdrk_brands_id = ${mfrId},
                  brand_list_id = (SELECT id FROM canonical),
                  match_method = 'MANUAL',
                  mapping_status = 'APPROVED'
              WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi güncellendi.' }, context)
      }

      case 'delete': {
        await db.$executeRaw(
          Prisma.sql`DELETE FROM v0.brand_mappings WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi silindi.' }, context)
      }

      default:
        return errorResponse({
          status: 400,
          code: 'INVALID_ACTION',
          message: `Bilinmeyen işlem: ${action}`,
          context
        })
    }
  } catch (error) {
    console.error(`[brand-aliases:${action}] Error for id=${id}:`, error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'İşlem sırasında hata oluştu.',
      context
    })
  }
}
