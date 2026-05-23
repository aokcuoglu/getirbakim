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
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'model-match:manual',
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
    const { matchId, dinamikProductId, dinamikStockCode, dinamikBrand, dinamikProductName } = body

    if (!matchId) {
      return errorResponse({ status: 400, code: 'MISSING_ID', message: 'matchId gerekli.', context })
    }

    const id = BigInt(matchId)

    const matchRows = await db.$queryRaw<
      Array<{ id: bigint; status: string; dinamik_product_id: bigint | null; parcatedarik_product_id: number }>
    >(Prisma.sql`SELECT id, status, dinamik_product_id, parcatedarik_product_id FROM public.dinamik_parcatedarik_model_matches WHERE id = ${id}`)

    if (!matchRows || matchRows.length === 0) {
      return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Eşleşme bulunamadı.', context })
    }

    const match = matchRows[0]

    if (dinamikProductId) {
      const dinId = BigInt(dinamikProductId)

      const dinProduct = await db.$queryRaw<
        Array<{ id: bigint; stock_code: string; stock_name: string | null; brand: string | null }>
      >(Prisma.sql`SELECT id, stock_code, stock_name, brand FROM dinamik.products WHERE id = ${dinId}`)

      if (!dinProduct || dinProduct.length === 0) {
        return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Dinamik ürün bulunamadı.', context })
      }

      const din = dinProduct[0]

      await db.$executeRaw(Prisma.sql`
        UPDATE public.dinamik_parcatedarik_model_matches
        SET dinamik_product_id = ${dinId},
            dinamik_stock_code = ${din.stock_code},
            dinamik_brand = ${din.brand || Prisma.sql`NULL`},
            dinamik_product_name = ${din.stock_name || Prisma.sql`NULL`},
            match_reason = 'MANUAL_MATCH',
            confidence = 0.9000,
            status = 'MANUAL_MATCH',
            review_note = 'Manuel eşleştirme - admin tarafından Dinamik ürün atandı',
            updated_at = NOW()
        WHERE id = ${id}::bigint
      `)

      const updated = await db.$queryRaw<
        Array<Record<string, unknown>>
      >(Prisma.sql`
        SELECT m.id, m.dinamik_product_id, m.parcatedarik_product_id,
               m.dinamik_barcode_field, m.dinamik_barcode_value, m.normalized_barcode_value,
               m.parcatedarik_model, m.normalized_model,
               m.match_reason, m.confidence, m.status, m.review_note,
               m.approved_by, m.approved_at, m.rejected_by, m.rejected_at,
               m.dinamik_stock_code, m.dinamik_brand, m.dinamik_product_name,
               m.created_at, m.updated_at
        FROM public.dinamik_parcatedarik_model_matches m
        WHERE m.id = ${id}
      `)

      return successResponse({
        match: updated[0],
        message: 'Dinamik ürün manuel olarak eşleştirildi.'
      }, context)
    }

    if (match.status === 'PT_UNMATCHED') {
      await db.$executeRaw(Prisma.sql`
        UPDATE public.dinamik_parcatedarik_model_matches
        SET dinamik_stock_code = ${dinamikStockCode || Prisma.sql`NULL`},
            dinamik_brand = ${dinamikBrand || Prisma.sql`NULL`},
            dinamik_product_name = ${dinamikProductName || Prisma.sql`NULL`},
            match_reason = 'MANUAL_MATCH',
            confidence = 0.9000,
            status = 'MANUAL_MATCH',
            updated_at = NOW()
        WHERE id = ${id}::bigint
      `)

      return successResponse({ message: 'Manuel eşleştirme bilgileri kaydedildi.' }, context)
    }

    return errorResponse({
      status: 400,
      code: 'INVALID_STATUS',
      message: `Eşleşme durumu '${match.status}' manuel eşleştirme için uygun değil. Sadece PT_UNMATCHED durumu destekleniyor.`,
      context
    })
  } catch (error) {
    console.error('[manual-match] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Manuel eşleştirme sırasında hata oluştu.', context })
  }
}