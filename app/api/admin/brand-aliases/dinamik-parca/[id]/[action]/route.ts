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
          Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
            SET mapping_status = 'APPROVED',
                approved_by = 'admin',
                approved_at = NOW(),
                updated_at = NOW()
            WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi onaylandı.' }, context)
      }

      case 'reject': {
        await db.$executeRaw(
          Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
            SET mapping_status = 'REJECTED',
                updated_at = NOW()
            WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi reddedildi.' }, context)
      }

      case 'ignore': {
        await db.$executeRaw(
          Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
            SET mapping_status = 'IGNORED',
                updated_at = NOW()
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
        >(Prisma.sql`SELECT id, name FROM parcatedarik.manufacturer WHERE id = ${mfrId}`)

        if (!manufacturer || manufacturer.length === 0) {
          return errorResponse({
            status: 404,
            code: 'NOT_FOUND',
            message: 'Üretici bulunamadı.',
            context
          })
        }

        const mfrName = manufacturer[0].name
        const normalizedPcMfr = normalizeModel(mfrName) || ''
        const confidence = body?.confidence ?? 0.95

        await db.$executeRaw(
          Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
            SET parcatedarik_manufacturer_id = ${mfrId},
                normalized_pc_manufacturer = ${normalizedPcMfr},
                confidence = ${confidence},
                match_method = 'MANUAL',
                mapping_status = 'APPROVED',
                approved_by = 'admin',
                approved_at = NOW(),
                updated_at = NOW()
            WHERE id = ${id}`
        )
        return successResponse({ id, action, message: 'Marka eşleştirmesi güncellendi.' }, context)
      }

      case 'delete': {
        await db.$executeRaw(
          Prisma.sql`DELETE FROM public.dinamik_parca_brand_aliases WHERE id = ${id}`
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