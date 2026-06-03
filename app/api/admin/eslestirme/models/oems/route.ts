import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:oems:search', limit: 200, windowMs: 60_000 })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const url = new URL(request.url)
  const refNo = (url.searchParams.get('refNo') ?? '').trim()
  const mappingIdStr = url.searchParams.get('mappingId')
  const dnmkIdStr = url.searchParams.get('dnmkProductsId')
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '25', 10)), 100)

  if (!refNo) {
    return errorResponse({ status: 400, code: 'MISSING_REF_NO', message: 'refNo parametresi gerekli.', context })
  }

  const mappingId = mappingIdStr ? parseInt(mappingIdStr, 10) : null
  const dnmkId = dnmkIdStr ? BigInt(dnmkIdStr) : null

  try {
    let mappingBrandListId: number | null = null
    if (mappingId && !isNaN(mappingId)) {
      const mapping = await db.$queryRaw<Array<{ brand_list_id: number | null }>>(
        Prisma.sql`SELECT brand_list_id FROM v0.product_mapping WHERE id = ${mappingId} LIMIT 1`
      )
      mappingBrandListId = mapping[0]?.brand_list_id ?? null
    } else if (dnmkId && (!mappingId || isNaN(mappingId as number))) {
      const mapping = await db.$queryRaw<Array<{ brand_list_id: number | null }>>(
        Prisma.sql`SELECT brand_list_id FROM v0.product_mapping WHERE dnmk_products_id = ${dnmkId} AND mapping_status = 'APPROVED' LIMIT 1`
      )
      mappingBrandListId = mapping[0]?.brand_list_id ?? null
    }

    const refNos = refNo.split(',').map(r => r.trim()).filter(Boolean)
    if (refNos.length === 0) {
      return errorResponse({ status: 400, code: 'EMPTY_REF_NO', message: 'Geçerli refNo bulunamadı.', context })
    }

    const results = await db.$queryRaw<Array<{
      id: bigint; malzeme_no: string; oem_no: string | null; aciklama: string | null
      bsbg_brands_id: bigint; bsbg_brand: string
      brand_list_id: number | null; canonical_brand: string | null
    }>>(
      Prisma.sql`
        SELECT b.id, b.malzeme_no, b.oem_no, b.aciklama, b.bsbg_brands_id,
               bb.brand AS bsbg_brand,
               bm.brand_list_id,
               bl.brand AS canonical_brand
        FROM v0.bsbg_products b
        JOIN v0.bsbg_brands bb ON bb.id = b.bsbg_brands_id
        LEFT JOIN v0.brand_mappings bm
          ON bm.bsbg_brands_id = b.bsbg_brands_id
         AND bm.mapping_status = 'APPROVED'
        LEFT JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        WHERE ${Prisma.join(refNos.map((_, i) => Prisma.sql`BTRIM(LOWER(b.oem_no)) = BTRIM(LOWER(${refNos[i]}))`), ' OR ')}
        ORDER BY b.oem_no ASC, b.malzeme_no ASC
        LIMIT ${limit}
      `
    )

    const savedOems = dnmkId
      ? await db.$queryRaw<Array<{ bsbg_products_id: bigint; oem_no: string }>>(
          Prisma.sql`SELECT bsbg_products_id, oem_no FROM v0.products_oems WHERE dnmk_products_id = ${dnmkId}`
        )
      : []

    const savedSet = new Set(savedOems.map(s => `${s.bsbg_products_id.toString()}_${s.oem_no}`))

    return successResponse({
      refNos,
      mappingBrandListId,
      results: results.map(r => {
        const bsbgBrandListId = r.brand_list_id
        const sameBrand = mappingBrandListId != null && bsbgBrandListId != null && mappingBrandListId === bsbgBrandListId
        const diffBrand = mappingBrandListId != null && bsbgBrandListId != null && mappingBrandListId !== bsbgBrandListId
        const relationType: string = sameBrand ? 'SAME_BRAND' : diffBrand ? 'CROSS_REFERENCE' : 'UNKNOWN'
        const bsbgId = r.id.toString()

        return {
          bsbgProductId: bsbgId,
          malzemeNo: r.malzeme_no,
          oemNo: r.oem_no,
          aciklama: r.aciklama,
          bsbgBrandId: r.bsbg_brands_id.toString(),
          bsbgBrand: r.bsbg_brand,
          canonicalBrand: r.canonical_brand,
          brandListId: bsbgBrandListId,
          relationType,
          alreadySaved: savedSet.has(`${bsbgId}_${r.oem_no}`),
        }
      }),
    }, context)
  } catch (error) {
    console.error('[eslestirme:models:oems:search] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'OEM araması sırasında hata oluştu.', context })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:oems:save', limit: 100, windowMs: 60_000 })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  try {
    const body = await request.json().catch(() => ({}))
    const dnmkProductsId = body?.dnmkProductsId ? BigInt(body.dnmkProductsId) : null
    const ptdrkProductsId = body?.ptdrkProductsId != null ? Number(body.ptdrkProductsId) : null
    const bsbgProductsId = body?.bsbgProductsId ? BigInt(body.bsbgProductsId) : null
    const oemNo = (body?.oemNo ?? '').trim() || null
    const refNo = (body?.refNo ?? '').trim() || null
    const relationType = body?.relationType || 'CROSS_REFERENCE'

    if (!bsbgProductsId) {
      return errorResponse({ status: 400, code: 'MISSING_BSBG_ID', message: 'bsbgProductsId gerekli.', context })
    }

    const action = body?.action || 'save'

    if (action === 'delete') {
      await db.$executeRawUnsafe(
        `DELETE FROM v0.products_oems WHERE dnmk_products_id = $1 AND bsbg_products_id = $2 AND oem_no IS NOT DISTINCT FROM $3`,
        dnmkProductsId, bsbgProductsId, oemNo
      )
      return successResponse({ message: 'OEM eşleştirmesi silindi.' }, context)
    }

    await db.$executeRawUnsafe(
      `INSERT INTO v0.products_oems (dnmk_products_id, ptdrk_products_id, bsbg_products_id, oem_no, ref_no, brand_list_id, relation_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (dnmk_products_id, bsbg_products_id, oem_no) DO UPDATE
       SET ptdrk_products_id = $2, ref_no = $5, brand_list_id = $6, relation_type = $7`,
      dnmkProductsId, ptdrkProductsId, bsbgProductsId, oemNo, refNo, null, relationType, auth.user.email || null
    )

    return successResponse({ message: 'OEM eşleştirmesi kaydedildi.' }, context)
  } catch (error) {
    console.error('[eslestirme:models:oems:save] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'OEM kaydı sırasında hata oluştu.', context })
  }
}
