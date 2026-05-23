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

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'brand-aliases:create',
    limit: 50,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  try {
    const body = await request.json()
    const dinamikBrand = (body?.dinamikBrand ?? '').trim()
    const parcatedarikManufacturerId = body?.parcatedarikManufacturerId ? parseInt(body.parcatedarikManufacturerId, 10) : null
    const acceptAsIs = body?.acceptAsIs ?? false
    const confidence = body?.confidence ?? 0.95

    if (!dinamikBrand) {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Dinamik marka adı gerekli.', context })
    }

    const normalizedDinamik = normalizeModel(dinamikBrand) || ''

    if (acceptAsIs) {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO public.dinamik_parca_brand_aliases (
          dinamik_brand, normalized_dinamik_brand, parcatedarik_manufacturer_id,
          normalized_pc_manufacturer, mapping_status, confidence, match_method,
          approved_by, approved_at
        ) VALUES (
          ${dinamikBrand},
          ${normalizedDinamik},
          NULL,
          NULL,
          'APPROVED',
          ${confidence},
          'MANUAL',
          'admin',
          NOW()
        )
        ON CONFLICT (dinamik_brand, parcatedarik_manufacturer_id)
        DO UPDATE SET
          mapping_status = 'APPROVED',
          confidence = ${confidence},
          match_method = 'MANUAL',
          approved_by = 'admin',
          approved_at = NOW(),
          updated_at = NOW()
      `)

      return successResponse({ message: 'Dinamik markası olduğu gibi kabul edildi.', acceptAsIs: true }, context)
    }

    if (!parcatedarikManufacturerId || isNaN(parcatedarikManufacturerId) || parcatedarikManufacturerId <= 0) {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Geçerli bir üretici ID veya "olduğu gibi kabul et" gerekli.', context })
    }

    const manufacturer = await db.$queryRaw<
      Array<{ id: number; name: string }>
    >(Prisma.sql`SELECT id, name FROM parcatedarik.manufacturer WHERE id = ${parcatedarikManufacturerId}`)

    if (!manufacturer || manufacturer.length === 0) {
      return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Üretici bulunamadı.', context })
    }

    const mfrName = manufacturer[0].name
    const normalizedPcMfr = normalizeModel(mfrName) || ''

    await db.$executeRaw(Prisma.sql`
      INSERT INTO public.dinamik_parca_brand_aliases (
        dinamik_brand, normalized_dinamik_brand, parcatedarik_manufacturer_id,
        normalized_pc_manufacturer, mapping_status, confidence, match_method,
        approved_by, approved_at
      ) VALUES (
        ${dinamikBrand},
        ${normalizedDinamik},
        ${parcatedarikManufacturerId},
        ${normalizedPcMfr},
        'APPROVED',
        ${confidence},
        'MANUAL',
        'admin',
        NOW()
      )
      ON CONFLICT (dinamik_brand, parcatedarik_manufacturer_id)
      DO UPDATE SET
        mapping_status = 'APPROVED',
        confidence = ${confidence},
        match_method = 'MANUAL',
        approved_by = 'admin',
        approved_at = NOW(),
        updated_at = NOW()
    `)

    return successResponse({ message: 'Marka eşleştirmesi oluşturuldu.' }, context)
  } catch (error) {
    console.error('[brand-aliases:create] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Oluşturma sırasında hata oluştu.', context })
  }
}