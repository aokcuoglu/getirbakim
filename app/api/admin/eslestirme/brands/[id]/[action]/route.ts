import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { revalidateAdminCatalogPaths } from '@/lib/admin/revalidate-catalog-paths'
import { removeRedundantDbrandsMatchRows } from '@/lib/admin/dbrands-match-cleanup'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { normalizeModel } from '@/lib/matching/code-normalization'

const VALID_ACTIONS = ['approve', 'reject', 'ignore', 'update', 'delete'] as const

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:brands:action',
    limit: 100,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const { id: idStr, action } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return errorResponse({ status: 400, code: 'INVALID_ID', message: 'Geçersiz ID.', context })
  if (!VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    return errorResponse({ status: 400, code: 'INVALID_ACTION', message: `Geçersiz işlem: ${action}`, context })
  }

  try {
    const body = await request.json().catch(() => ({}))

    switch (action) {
      case 'approve': {
        await db.$executeRaw(Prisma.sql`UPDATE v0.dbrands_match SET mapping_status = 'APPROVED' WHERE id = ${id}`)
        await removeRedundantDbrandsMatchRows()
        revalidateAdminCatalogPaths()
        return successResponse({ id, action, message: 'Marka eşleştirmesi onaylandı.' }, context)
      }
      case 'reject': {
        await db.$executeRaw(Prisma.sql`UPDATE v0.dbrands_match SET mapping_status = 'REJECTED' WHERE id = ${id}`)
        return successResponse({ id, action, message: 'Marka eşleştirmesi reddedildi.' }, context)
      }
      case 'ignore': {
        await db.$executeRaw(Prisma.sql`UPDATE v0.dbrands_match SET mapping_status = 'IGNORED' WHERE id = ${id}`)
        return successResponse({ id, action, message: 'Marka eşleştirmesi yoksayıldı.' }, context)
      }
      case 'update': {
        const parcatedarikManufacturerId = body?.parcatedarikManufacturerId
        const dinamikBrandId = body?.dinamikBrandId

        if (parcatedarikManufacturerId != null) {
          const mfrId = parseInt(String(parcatedarikManufacturerId), 10)
          if (isNaN(mfrId) || mfrId <= 0) {
            return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Geçersiz parcatedarikManufacturerId.', context })
          }
          const manufacturer = await db.$queryRaw<Array<{ id: number; name: string }>>(
            Prisma.sql`SELECT id, name FROM v0.ptbrands WHERE id = ${mfrId}`
          )
          if (!manufacturer || manufacturer.length === 0) {
            return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Üretici bulunamadı.', context })
          }
          const mfrName = manufacturer[0].name
          const normalized = normalizeModel(mfrName) || ''
          await db.$executeRaw(Prisma.sql`UPDATE v0.dbrands_match SET ptbrands_id = ${mfrId}, normalized = ${normalized}, match_method = 'MANUAL', mapping_status = 'APPROVED' WHERE id = ${id}`)
          await removeRedundantDbrandsMatchRows()
          revalidateAdminCatalogPaths()
          return successResponse({ id, action, message: 'Marka eşleştirmesi güncellendi.' }, context)
        }

        if (dinamikBrandId != null) {
          const brandId = parseInt(String(dinamikBrandId), 10)
          if (isNaN(brandId) || brandId <= 0) {
            return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Geçersiz dinamikBrandId.', context })
          }
          const brand = await db.$queryRaw<Array<{ id: number; brand: string }>>(
            Prisma.sql`SELECT id::int AS id, brand FROM v0.dbrands WHERE id = ${brandId}`
          )
          if (!brand || brand.length === 0) {
            return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Dinamik marka bulunamadı.', context })
          }
          await db.$executeRaw(Prisma.sql`UPDATE v0.dbrands_match SET dbrands_id = ${brandId}, match_method = 'MANUAL', mapping_status = 'APPROVED' WHERE id = ${id}`)
          await removeRedundantDbrandsMatchRows()
          revalidateAdminCatalogPaths()
          return successResponse({ id, action, message: 'Marka eşleştirmesi güncellendi.' }, context)
        }

        return errorResponse({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'parcatedarikManufacturerId veya dinamikBrandId gerekli.',
          context,
        })
      }
      case 'delete': {
        await db.$executeRaw(Prisma.sql`DELETE FROM v0.dbrands_match WHERE id = ${id}`)
        return successResponse({ id, action, message: 'Marka eşleştirmesi silindi.' }, context)
      }
      default:
        return errorResponse({ status: 400, code: 'INVALID_ACTION', message: `Bilinmeyen işlem: ${action}`, context })
    }
  } catch (error) {
    console.error(`[eslestirme:brands:${action}] Error for id=${id}:`, error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'İşlem sırasında hata oluştu.', context })
  }
}
