import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { resolveBrandListId, generateBsbgMalzemeNo } from '@/lib/admin/bsbg-oem-link'

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
  const ptdrkIdStr = url.searchParams.get('ptdrkProductsId')
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '25', 10)), 100)

  const mappingId = mappingIdStr ? parseInt(mappingIdStr, 10) : null
  const dnmkId = dnmkIdStr ? BigInt(dnmkIdStr) : null
  const ptdrkId = ptdrkIdStr ? parseInt(ptdrkIdStr, 10) : null

  try {
    // ---------------------------------------------------------------
    // Saved OEMs (products_oems) — always fetched when product is known
    // ---------------------------------------------------------------
    const savedOems = (dnmkId || ptdrkId)
      ? await db.$queryRaw<Array<{ id: number; bsbg_products_id: bigint | null; oem_no: string; ref_no: string | null; brand_list_id: number | null; relation_type: string; created_at: Date; malzeme_no: string | null; bsbg_brand: string | null }>>(
          Prisma.sql`
            SELECT po.id, po.bsbg_products_id, po.oem_no, po.ref_no, po.brand_list_id, po.relation_type, po.created_at,
                   b.malzeme_no, bb.brand AS bsbg_brand
            FROM v0.products_oems po
            LEFT JOIN v0.bsbg_products b ON b.id = po.bsbg_products_id
            LEFT JOIN v0.bsbg_brands bb ON bb.id = b.bsbg_brands_id
            WHERE ${dnmkId ? Prisma.sql`po.dnmk_products_id = ${dnmkId}` : Prisma.sql`po.ptdrk_products_id = ${ptdrkId}`}
            ORDER BY po.created_at DESC
          `
        )
      : []

    // ---------------------------------------------------------------
    // Bsbg search by refNo — only when refNo is provided
    // ---------------------------------------------------------------
    let mappingBrandListId: number | null = null
    let results: any[] = []

    if (refNo) {
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

      const refNos = refNo.split(/[,;|/]+/).map(r => r.trim()).filter(Boolean)
      if (refNos.length > 0) {
        const searchResults = await db.$queryRaw<Array<{
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

        const savedSet = new Set(savedOems.filter(s => s.bsbg_products_id).map(s => `${s.bsbg_products_id!.toString()}_${s.oem_no}`))

        results = searchResults.map(r => {
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
        })
      }
    }

    return successResponse({
      refNos: refNo ? refNo.split(/[,;|/]+/).map(r => r.trim()).filter(Boolean) : [],
      mappingBrandListId,
      results,
      saved: savedOems.map(s => ({
        id: s.id,
        oemNo: s.oem_no,
        refNo: s.ref_no,
        malzemeNo: s.malzeme_no,
        bsbgBrand: s.bsbg_brand,
        bsbgProductId: s.bsbg_products_id?.toString() ?? null,
        brandListId: s.brand_list_id,
        relationType: s.relation_type,
        createdAt: s.created_at.toISOString(),
      })),
    }, context)
  } catch (error) {
    console.error('[eslestirme:models:oems:search] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'OEM araması sırasında hata oluştu.', context })
  }
}

function computeRelationType(
  mappingBrandListId: number | null,
  itemBrandListId: number | null,
): string {
  if (mappingBrandListId == null || itemBrandListId == null) return 'UNKNOWN'
  return mappingBrandListId === itemBrandListId ? 'SAME_BRAND' : 'CROSS_REFERENCE'
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
    const brandListId = body?.brandListId != null ? Number(body.brandListId) : null
    const savedOemId = body?.id != null ? Number(body.id) : null

    const action = body?.action || 'save'

    // ---------------------------------------------------------------
    // Delete
    // ---------------------------------------------------------------
    if (action === 'delete') {
      if (savedOemId) {
        await db.$executeRaw(Prisma.sql`DELETE FROM v0.products_oems WHERE id = ${savedOemId}`)
      } else {
        if (!bsbgProductsId) {
          return errorResponse({ status: 400, code: 'MISSING_BSBG_ID', message: 'bsbgProductsId gerekli.', context })
        }
        await db.$executeRawUnsafe(
          `DELETE FROM v0.products_oems WHERE dnmk_products_id = $1 AND bsbg_products_id = $2 AND oem_no IS NOT DISTINCT FROM $3`,
          dnmkProductsId, bsbgProductsId, oemNo,
        )
      }
      return successResponse({ message: 'OEM eşleştirmesi silindi.' }, context)
    }

    // ---------------------------------------------------------------
    // Preview — check which OEM numbers exist / need to be created
    // ---------------------------------------------------------------
    if (action === 'preview') {
      const oemNos: string[] = (body?.oemNos ?? []).filter((s: string) => s.trim().length >= 2)
      if (oemNos.length === 0) {
        return successResponse({ previews: [], mappingBrandListId: null, mappingResolved: false }, context)
      }

      const resolved = await resolveBrandListId({
        mappingId: body?.mappingId ? Number(body.mappingId) : null,
        dnmkProductsId,
        ptdrkProductsId,
      })

      const previews: any[] = []
      const alreadySavedMap: Map<string, boolean> = new Map()
      if (dnmkProductsId) {
        const savedRows = await db.$queryRaw<Array<{ bsbg_products_id: bigint; oem_no: string }>>(
          Prisma.sql`
            SELECT bsbg_products_id, oem_no FROM v0.products_oems
            WHERE dnmk_products_id = ${dnmkProductsId}
          `,
        )
        for (const r of savedRows) {
          alreadySavedMap.set(
            `${r.bsbg_products_id.toString()}_${(r.oem_no ?? '').toLowerCase().trim()}`,
            true,
          )
        }
      }

      for (const rawOem of oemNos) {
        const oemTrimmed = rawOem.trim()

        const bsbgResults = await db.$queryRaw<
          Array<{
            id: bigint
            malzeme_no: string
            oem_no: string | null
            bsbg_brands_id: bigint
            bsbg_brand: string
            brand_list_id: number | null
          }>
        >(
          Prisma.sql`
            SELECT b.id, b.malzeme_no, b.oem_no, b.bsbg_brands_id,
                   bb.brand AS bsbg_brand,
                   bm.brand_list_id
            FROM v0.bsbg_products b
            JOIN v0.bsbg_brands bb ON bb.id = b.bsbg_brands_id
            LEFT JOIN v0.brand_mappings bm
              ON bm.bsbg_brands_id = b.bsbg_brands_id
             AND bm.mapping_status = 'APPROVED'
            WHERE BTRIM(LOWER(b.oem_no)) = BTRIM(LOWER(${oemTrimmed}))
            ORDER BY b.id ASC
            LIMIT 1
          `,
        )

        if (bsbgResults.length > 0) {
          const match = bsbgResults[0]
          const bsbgBlId = match.brand_list_id
          const alreadySaved = alreadySavedMap.has(
            `${match.id.toString()}_${(match.oem_no ?? '').toLowerCase().trim()}`,
          )
          previews.push({
            oemNo: oemTrimmed,
            status: 'found',
            bsbgProductId: match.id.toString(),
            malzemeNo: match.malzeme_no,
            bsbgBrandId: match.bsbg_brands_id.toString(),
            bsbgBrand: match.bsbg_brand,
            brandListId: bsbgBlId,
            relationType: computeRelationType(resolved.brandListId, bsbgBlId),
            alreadySaved,
          })
        } else {
          previews.push({
            oemNo: oemTrimmed,
            status: 'create_needed',
            bsbgProductId: null,
            malzemeNo: generateBsbgMalzemeNo(oemTrimmed),
            bsbgBrandId: resolved.bsbgBrandId?.toString() ?? null,
            bsbgBrand: null,
            brandListId: resolved.brandListId,
            relationType: resolved.brandListId != null ? 'SAME_BRAND' : 'UNKNOWN',
            alreadySaved: false,
          })
        }
      }

      return successResponse(
        {
          previews,
          mappingBrandListId: resolved.brandListId,
          mappingResolved: resolved.brandListId != null && resolved.bsbgBrandId != null,
        },
        context,
      )
    }

    // ---------------------------------------------------------------
    // Save manual — optionally create bsbg_products row then upsert
    // ---------------------------------------------------------------
    if (action === 'save_manual') {
      const createBsbgIfMissing = body?.createBsbgIfMissing === true
      const bsbgBrandIdRaw = body?.bsbgBrandId ? BigInt(body.bsbgBrandId) : null

      let finalBsbgId = bsbgProductsId

      if (!finalBsbgId && createBsbgIfMissing) {
        if (!bsbgBrandIdRaw) {
          return errorResponse({
            status: 400,
            code: 'MISSING_BSBG_BRAND_ID',
            message: 'Yeni bsbg ürünü oluşturmak için bsbgBrandId gerekli.',
            context,
          })
        }
        const malzemeNo = generateBsbgMalzemeNo(oemNo ?? '')
        const inserted = await db.$queryRaw<Array<{ id: bigint }>>(
          Prisma.sql`
            INSERT INTO v0.bsbg_products
              (bsbg_brands_id, malzeme_no, oem_no, liste_grubu_kodu, raw, is_passive)
            VALUES (${bsbgBrandIdRaw}, ${malzemeNo}, ${oemNo}, 'MANUAL_OEM', '{}'::jsonb, false)
            RETURNING id
          `,
        )
        finalBsbgId = inserted[0]?.id ?? null
      }

      if (finalBsbgId) {
        await db.$executeRawUnsafe(
          `INSERT INTO v0.products_oems (dnmk_products_id, ptdrk_products_id, bsbg_products_id, oem_no, ref_no, brand_list_id, relation_type, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (dnmk_products_id, bsbg_products_id, oem_no) DO UPDATE
           SET ptdrk_products_id = $2, ref_no = $5, brand_list_id = $6, relation_type = $7`,
          dnmkProductsId,
          ptdrkProductsId,
          finalBsbgId,
          oemNo,
          refNo,
          brandListId,
          relationType,
          auth.user.email || null,
        )
      } else {
        const existing = await db.$queryRaw<Array<{ id: number }>>(
          Prisma.sql`
            SELECT id FROM v0.products_oems
            WHERE dnmk_products_id = ${dnmkProductsId}
              AND bsbg_products_id IS NULL
              AND oem_no = ${oemNo}
            LIMIT 1
          `,
        )
        if (existing.length > 0) {
          await db.$executeRawUnsafe(
            `UPDATE v0.products_oems SET ptdrk_products_id = $1, ref_no = $2, brand_list_id = $3, relation_type = $4, created_by = $5
             WHERE id = $6`,
            ptdrkProductsId, refNo, brandListId, relationType, auth.user.email || null, existing[0].id,
          )
        } else {
          await db.$executeRawUnsafe(
            `INSERT INTO v0.products_oems (dnmk_products_id, ptdrk_products_id, bsbg_products_id, oem_no, ref_no, brand_list_id, relation_type, created_by)
             VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)`,
            dnmkProductsId, ptdrkProductsId, oemNo, refNo, brandListId, relationType, auth.user.email || null,
          )
        }
      }

      return successResponse({ message: 'OEM kaydedildi.', bsbgProductsId: finalBsbgId?.toString() ?? null }, context)
    }

    // ---------------------------------------------------------------
    // Default save (existing behaviour + brand_list_id fix)
    // ---------------------------------------------------------------
    if (!bsbgProductsId) {
      return errorResponse({ status: 400, code: 'MISSING_BSBG_ID', message: 'bsbgProductsId gerekli.', context })
    }

    let resolvedBrandListId = brandListId
    if (resolvedBrandListId == null) {
      const resolved = await resolveBrandListId({
        mappingId: null,
        dnmkProductsId,
        ptdrkProductsId,
      })
      resolvedBrandListId = resolved.brandListId
    }

    await db.$executeRawUnsafe(
      `INSERT INTO v0.products_oems (dnmk_products_id, ptdrk_products_id, bsbg_products_id, oem_no, ref_no, brand_list_id, relation_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (dnmk_products_id, bsbg_products_id, oem_no) DO UPDATE
       SET ptdrk_products_id = $2, ref_no = $5, brand_list_id = $6, relation_type = $7`,
      dnmkProductsId, ptdrkProductsId, bsbgProductsId, oemNo, refNo, resolvedBrandListId, relationType, auth.user.email || null,
    )

    return successResponse({ message: 'OEM eşleştirmesi kaydedildi.' }, context)
  } catch (error) {
    console.error('[eslestirme:models:oems:save] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'OEM kaydı sırasında hata oluştu.', context })
  }
}
