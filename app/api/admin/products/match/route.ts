import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\n\r]+/g, ' ')
    .replace(/[^\w\sçğıöşüa-zA-Z0-9\-\.\/]/g, '')
    .trim()
}

function buildBestDisplayName(
  dnmkStockName: string | null,
  dnmkPartNo: string | null,
  dnmkStockCode: string | null,
  ptdrkTitle: string | null,
  bsbgAciklama: string | null,
  bsbgPartNo: string | null,
  bsbgMalzemeNo: string | null
): string {
  return dnmkStockName
    ?? ptdrkTitle
    ?? bsbgAciklama
    ?? `${dnmkPartNo || dnmkStockCode || bsbgPartNo || bsbgMalzemeNo || 'Ürün'}`
}

async function consolidateToV0Products(mappingId: bigint, approvedBy: string | null) {
  const mapping = await db.$queryRaw<
    Array<{
      id: bigint
      brand_list_id: number
      dnmk_products_id: bigint | null
      ptdrk_products_id: number | null
      bsbg_products_id: bigint | null
      dnmk_stock_name: string | null
      dnmk_part_no: string | null
      dnmk_stock_code: string | null
      dnmk_image_url: string | null
      dnmk_oem_no: string | null
      ptdrk_title: string | null
      ptdrk_ref_no: string | null
      bsbg_aciklama: string | null
      bsbg_part_no: string | null
      bsbg_malzeme_no: string | null
      bsbg_oem_no: string | null
      brand_name: string
    }>
  >(Prisma.sql`
    SELECT
      pm.id,
      pm.brand_list_id,
      pm.dnmk_products_id,
      pm.ptdrk_products_id,
      pm.bsbg_products_id,
      dp.stock_name AS dnmk_stock_name,
      dp.part_no AS dnmk_part_no,
      dp.stock_code AS dnmk_stock_code,
      dp.image_url AS dnmk_image_url,
      dp.oem_no AS dnmk_oem_no,
      pp.title AS ptdrk_title,
      pp.ref_no AS ptdrk_ref_no,
      bp.aciklama AS bsbg_aciklama,
      bp.part_no AS bsbg_part_no,
      bp.malzeme_no AS bsbg_malzeme_no,
      bp.oem_no AS bsbg_oem_no,
      bl.brand AS brand_name
    FROM v0.product_mappings pm
    LEFT JOIN v0.dnmk_products dp ON dp.id = pm.dnmk_products_id
    LEFT JOIN v0.ptdrk_products pp ON pp.id = pm.ptdrk_products_id
    LEFT JOIN v0.bsbg_products bp ON bp.id = pm.bsbg_products_id
    JOIN v0.brand_list bl ON bl.id = pm.brand_list_id
    WHERE pm.id = ${mappingId}
  `)

  if (mapping.length === 0) return

  const row = mapping[0]
  const displayName = buildBestDisplayName(
    row.dnmk_stock_name, row.dnmk_part_no, row.dnmk_stock_code,
    row.ptdrk_title,
    row.bsbg_aciklama, row.bsbg_part_no, row.bsbg_malzeme_no
  )

  // UPSERT v0.products by product_mapping_id
  const productId = await db.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
    INSERT INTO v0.products (display_name, normalized_name, brand_name, brand_list_id, primary_image_url, product_mapping_id)
    VALUES (
      ${displayName},
      ${normalizeProductName(displayName)},
      ${row.brand_name},
      ${row.brand_list_id},
      ${row.dnmk_image_url ?? null},
      ${row.id}
    )
    ON CONFLICT (product_mapping_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          normalized_name = EXCLUDED.normalized_name,
          brand_name = EXCLUDED.brand_name,
          brand_list_id = EXCLUDED.brand_list_id,
          primary_image_url = COALESCE(EXCLUDED.primary_image_url, v0.products.primary_image_url)
    RETURNING id
  `)

  if (productId.length === 0) return
  const v0ProductId = productId[0].id

  // Collect OEM tokens from all available sources
  const oemTokens: string[] = []
  if (row.dnmk_oem_no) {
    oemTokens.push(...row.dnmk_oem_no.split(',').map(s => s.trim()).filter(Boolean))
  }
  if (row.bsbg_oem_no) {
    oemTokens.push(...row.bsbg_oem_no.split(',').map(s => s.trim()).filter(Boolean))
  }
  if (row.ptdrk_ref_no) {
    const tokens = row.ptdrk_ref_no.split(/[,;|/]/).map(s => s.trim()).filter(Boolean)
    oemTokens.push(...tokens)
  }

  const uniqueOems = [...new Set(oemTokens)]
  if (uniqueOems.length > 0) {
    for (const oem of uniqueOems) {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO v0.products_oems (v0_product_id, oem_no, source)
        VALUES (${v0ProductId}, ${oem}, 'MAPPING')
        ON CONFLICT (v0_product_id, oem_no) DO NOTHING
      `)
    }
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'admin:products:match',
    limit: 60,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user || auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Admin required.', context })
  }

  const url = new URL(request.url)
  const q = url.searchParams.get('q') ?? ''
  const source = url.searchParams.get('source') ?? 'dnmk'
  const brandListId = url.searchParams.get('brandListId')
  const matchSide = url.searchParams.get('matchSide') ?? 'all'
  const target = url.searchParams.get('target')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  try {
    // ── Brands list ──────────────────────────────────────────────────────────
    if (target === 'brands') {
      let brandFilter: ReturnType<typeof Prisma.sql>
      if (source === 'bsbg') {
        brandFilter = Prisma.sql`WHERE bm.bsbg_brands_id IS NOT NULL`
      } else if (source === 'ptdrk') {
        brandFilter = Prisma.sql`WHERE bm.ptdrk_brands_id IS NOT NULL`
      } else {
        brandFilter = Prisma.sql`WHERE bm.dnmk_brands_id IS NOT NULL`
      }
      const brands = await db.$queryRaw<Array<{ id: number; brand: string }>>(Prisma.sql`
        SELECT DISTINCT bl.id, bl.brand
        FROM v0.brand_list bl
        JOIN v0.brand_mappings bm ON bm.brand_list_id = bl.id
        ${brandFilter}
        ORDER BY bl.brand
      `)
      return successResponse({ rows: brands }, context)
    }

    // ── Match-dialog: search ptdrk products ──────────────────────────────────
    if (target === 'ptdrk' && brandListId) {
      const brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      const searchFilter = q
        ? Prisma.sql`AND (pp.part_no ILIKE ${'%' + q + '%'} OR pp.product_id ILIKE ${'%' + q + '%'} OR pp.title ILIKE ${'%' + q + '%'} OR pp.ref_no ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS n
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        WHERE NOT EXISTS (
          SELECT 1 FROM v0.product_mappings pm
          WHERE pm.ptdrk_products_id = pp.id
        )
        ${brandFilter}
        ${searchFilter}
      `)
      const total = Number(countResult[0]?.n ?? 0)

      const rows = await db.$queryRaw<
        Array<{ id: number; product_id: string; part_no: string | null; title: string }>
      >(Prisma.sql`
        SELECT pp.id, pp.product_id, pp.part_no, pp.title
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        WHERE NOT EXISTS (
          SELECT 1 FROM v0.product_mappings pm
          WHERE pm.ptdrk_products_id = pp.id
        )
        ${brandFilter}
        ${searchFilter}
        ORDER BY pp.part_no
        LIMIT ${limit} OFFSET ${offset}
      `)

      return successResponse({ rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, context)
    }

    // ── Match-dialog: search bsbg products ───────────────────────────────────
    if (target === 'bsbg' && brandListId) {
      const brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      const searchFilter = q
        ? Prisma.sql`AND (bp.malzeme_no ILIKE ${'%' + q + '%'} OR bp.part_no ILIKE ${'%' + q + '%'} OR bp.aciklama ILIKE ${'%' + q + '%'} OR bp.oem_no ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS n
        FROM v0.bsbg_products bp
        JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
        WHERE NOT EXISTS (
          SELECT 1 FROM v0.product_mappings pm
          WHERE pm.bsbg_products_id = bp.id
        )
        ${brandFilter}
        ${searchFilter}
      `)
      const total = Number(countResult[0]?.n ?? 0)

      const rows = await db.$queryRaw<
        Array<{ id: number; malzeme_no: string; part_no: string | null; aciklama: string | null }>
      >(Prisma.sql`
        SELECT bp.id, bp.malzeme_no, bp.part_no, bp.aciklama
        FROM v0.bsbg_products bp
        JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
        WHERE NOT EXISTS (
          SELECT 1 FROM v0.product_mappings pm
          WHERE pm.bsbg_products_id = bp.id
        )
        ${brandFilter}
        ${searchFilter}
        ORDER BY bp.part_no
        LIMIT ${limit} OFFSET ${offset}
      `)

      return successResponse({ rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, context)
    }

    // ── Match-dialog: search dnmk products ───────────────────────────────────
    if (target === 'dnmk' && brandListId) {
      const brandSearchFilter = q
        ? Prisma.sql`AND (dp.stock_code ILIKE ${'%' + q + '%'} OR dp.part_no ILIKE ${'%' + q + '%'} OR dp.stock_name ILIKE ${'%' + q + '%'} OR dp.barcode_1 ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      const rows = await db.$queryRaw<
        Array<{ id: number; stock_code: string; part_no: string | null; stock_name: string | null }>
      >(Prisma.sql`
        SELECT dp.id, dp.stock_code, dp.part_no, dp.stock_name
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        WHERE bm.brand_list_id = ${parseInt(brandListId)}
        AND NOT EXISTS (
          SELECT 1 FROM v0.product_mappings pm
          WHERE pm.dnmk_products_id = dp.id
        )
        ${brandSearchFilter}
        ORDER BY dp.part_no
        LIMIT ${limit} OFFSET ${offset}
      `)

      return successResponse({ rows }, context)
    }

    // ── Source: DNMK products ────────────────────────────────────────────────
    if (source === 'dnmk') {
      // matched/pending always return empty (no mapping data)
      if (matchSide === 'matched' || matchSide === 'pending') {
        return successResponse({ rows: [], pagination: { page, limit, total: 0, pages: 0 }, summary: { total: 0, matched: 0, pending: 0, unmatched: 0 } }, context)
      }

      const searchFilter = q
        ? Prisma.sql`AND (bl.brand ILIKE ${'%' + q + '%'} OR dp.stock_code ILIKE ${'%' + q + '%'} OR dp.part_no ILIKE ${'%' + q + '%'} OR dp.stock_name ILIKE ${'%' + q + '%'} OR dp.barcode_1 ILIKE ${'%' + q + '%'} OR dp.barcode_2 ILIKE ${'%' + q + '%'} OR dp.barcode_3 ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      let brandFilter = Prisma.empty
      if (brandListId) {
        brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      }

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT dp.id)::bigint AS n
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
      `)
      const total = Number(countResult[0]?.n ?? 0)

      const rows = await db.$queryRaw<
        Array<{
          id: bigint
          stock_code: string
          part_no: string | null
          stock_name: string | null
          brand: string
          brand_list_id: number
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (dp.id)
          dp.id,
          dp.stock_code,
          dp.part_no,
          dp.stock_name,
          bl.brand,
          bm.brand_list_id
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ORDER BY dp.id, bl.brand, dp.stock_code
        LIMIT ${limit} OFFSET ${offset}
      `)

      return successResponse({
        rows: rows.map((r) => ({ id: Number(r.id), stock_code: r.stock_code, part_no: r.part_no, stock_name: r.stock_name, brand: r.brand, brand_list_id: r.brand_list_id })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { total, matched: 0, pending: 0, unmatched: total }
      }, context)
    }

    // ── Source: BSBG products ────────────────────────────────────────────────
    if (source === 'bsbg') {
      if (matchSide === 'matched' || matchSide === 'pending') {
        return successResponse({ rows: [], pagination: { page, limit, total: 0, pages: 0 }, summary: { total: 0, matched: 0, pending: 0, unmatched: 0 } }, context)
      }

      const searchFilter = q
        ? Prisma.sql`AND (bl.brand ILIKE ${'%' + q + '%'} OR bp.malzeme_no ILIKE ${'%' + q + '%'} OR bp.part_no ILIKE ${'%' + q + '%'} OR bp.aciklama ILIKE ${'%' + q + '%'} OR bp.oem_no ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      let brandFilter = Prisma.empty
      if (brandListId) {
        brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      }

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT bp.id)::bigint AS n
        FROM v0.bsbg_products bp
        JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
      `)
      const total = Number(countResult[0]?.n ?? 0)

      const rows = await db.$queryRaw<
        Array<{
          id: bigint
          malzeme_no: string
          part_no: string | null
          aciklama: string | null
          brand: string
          brand_list_id: number
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (bp.id)
          bp.id,
          bp.malzeme_no,
          bp.part_no,
          bp.aciklama,
          bl.brand,
          bm.brand_list_id
        FROM v0.bsbg_products bp
        JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ORDER BY bp.id, bl.brand, bp.malzeme_no
        LIMIT ${limit} OFFSET ${offset}
      `)

      return successResponse({
        rows: rows.map((r) => ({ id: Number(r.id), malzeme_no: r.malzeme_no, part_no: r.part_no, aciklama: r.aciklama, brand: r.brand, brand_list_id: r.brand_list_id })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { total, matched: 0, pending: 0, unmatched: total }
      }, context)
    }

    // ── Source: PTDRK products ───────────────────────────────────────────────
    if (source === 'ptdrk') {
      if (matchSide === 'matched' || matchSide === 'pending') {
        return successResponse({ rows: [], pagination: { page, limit, total: 0, pages: 0 }, summary: { total: 0, matched: 0, pending: 0, unmatched: 0 } }, context)
      }

      const searchFilter = q
        ? Prisma.sql`AND (bl.brand ILIKE ${'%' + q + '%'} OR pp.product_id ILIKE ${'%' + q + '%'} OR pp.part_no ILIKE ${'%' + q + '%'} OR pp.title ILIKE ${'%' + q + '%'} OR pp.ref_no ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      let brandFilter = Prisma.empty
      if (brandListId) {
        brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      }

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT pp.id)::bigint AS n
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
      `)
      const total = Number(countResult[0]?.n ?? 0)

      const rows = await db.$queryRaw<
        Array<{
          id: number
          product_id: string
          part_no: string | null
          title: string
          brand: string
          brand_list_id: number
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (pp.id)
          pp.id,
          pp.product_id,
          pp.part_no,
          pp.title,
          bl.brand,
          bm.brand_list_id
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ORDER BY pp.id, bl.brand, pp.part_no
        LIMIT ${limit} OFFSET ${offset}
      `)

      return successResponse({
        rows: rows.map((r) => ({ ...r })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { total, matched: 0, pending: 0, unmatched: total }
      }, context)
    }

    return errorResponse({ status: 400, code: 'INVALID_SOURCE', message: 'Geçersiz kaynak.', context })
  } catch (error) {
    console.error('[admin:products:match] Error:', error)
    return errorResponse({ status: 500, code: 'PRODUCT_MATCH_FAILED', message: 'Ürünler yüklenemedi.', context })
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'admin:products:match',
    limit: 30,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user || auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Admin required.', context })
  }

  try {
    const body = await request.json()
    const { dnmkProductsId, bsbgProductsId, ptdrkProductsId, brandListId, action } = body

    if (!dnmkProductsId && !bsbgProductsId) {
      return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'dnmkProductsId or bsbgProductsId required.', context })
    }

    // ── Actions for PENDING mappings ─────────────────────────────────────────
    if (action) {
      if (action === 'approve_pending') {
        if (dnmkProductsId) {
          await db.$executeRaw(Prisma.sql`
            UPDATE v0.product_mappings
            SET mapping_status = 'APPROVED',
                approved_by = ${auth?.user?.email ?? null},
                approved_at = NOW()
            WHERE dnmk_products_id = ${dnmkProductsId}
              AND mapping_status = 'PENDING'
          `)
        } else if (bsbgProductsId) {
          await db.$executeRaw(Prisma.sql`
            UPDATE v0.product_mappings
            SET mapping_status = 'APPROVED',
                approved_by = ${auth?.user?.email ?? null},
                approved_at = NOW()
            WHERE bsbg_products_id = ${bsbgProductsId}
              AND mapping_status = 'PENDING'
          `)
        }

        // Consolidate to v0.products after approval
        const mappingId = await findMappingId(dnmkProductsId, bsbgProductsId, null)
        if (mappingId) await consolidateToV0Products(mappingId, auth?.user?.email ?? null)

        return successResponse({ success: true }, context)
      }

      if (action === 'ignore_pending') {
        if (dnmkProductsId) {
          await db.$executeRaw(Prisma.sql`
            UPDATE v0.product_mappings
            SET mapping_status = 'IGNORED', ignored_at = NOW()
            WHERE dnmk_products_id = ${dnmkProductsId}
              AND mapping_status = 'PENDING'
          `)
        } else if (bsbgProductsId) {
          await db.$executeRaw(Prisma.sql`
            UPDATE v0.product_mappings
            SET mapping_status = 'IGNORED', ignored_at = NOW()
            WHERE bsbg_products_id = ${bsbgProductsId}
              AND mapping_status = 'PENDING'
          `)
        }
        return successResponse({ success: true }, context)
      }

      if (action === 'rematch') {
        if (dnmkProductsId) {
          await db.$executeRaw(Prisma.sql`
            DELETE FROM v0.product_mappings
            WHERE dnmk_products_id = ${dnmkProductsId}
              AND mapping_status = 'PENDING'
          `)
        } else if (bsbgProductsId) {
          await db.$executeRaw(Prisma.sql`
            DELETE FROM v0.product_mappings
            WHERE bsbg_products_id = ${bsbgProductsId}
              AND mapping_status = 'PENDING'
          `)
        }

        // Remove the consolidated v0.product if exists
        const mappingId = await findMappingId(dnmkProductsId, bsbgProductsId, null)
        if (mappingId) {
          await db.$executeRaw(Prisma.sql`
            DELETE FROM v0.products WHERE product_mapping_id = ${mappingId}
          `)
        }

        return successResponse({ success: true }, context)
      }
    }

    // ── Manual link: DNMK ↔ PT ──────────────────────────────────────────────
    if (dnmkProductsId && ptdrkProductsId) {
      if (!brandListId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId required.', context })
      }

      await db.$executeRaw(Prisma.sql`
        INSERT INTO v0.product_mappings
          (brand_list_id, dnmk_products_id, ptdrk_products_id, mapping_status, match_method, confidence)
        VALUES (${brandListId}, ${dnmkProductsId}, ${ptdrkProductsId}, 'APPROVED', 'MANUAL', 1.0000)
        ON CONFLICT (dnmk_products_id, ptdrk_products_id) WHERE ptdrk_products_id IS NOT NULL
        DO UPDATE SET mapping_status = 'APPROVED', match_method = 'MANUAL', confidence = 1.0000
      `)

      // Consolidate
      const mappingId = await findMappingId(dnmkProductsId, null, ptdrkProductsId)
      if (mappingId) await consolidateToV0Products(mappingId, auth?.user?.email ?? null)

      return successResponse({ success: true }, context)
    }

    // ── Manual link: DNMK ↔ BSBG ────────────────────────────────────────────
    if (dnmkProductsId && bsbgProductsId) {
      if (!brandListId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId required.', context })
      }

      // Upsert the mapping row — link bsbg to the existing dnmk mapping if present
      await db.$executeRaw(Prisma.sql`
        INSERT INTO v0.product_mappings
          (brand_list_id, dnmk_products_id, bsbg_products_id, mapping_status, match_method, confidence)
        VALUES (${brandListId}, ${dnmkProductsId}, ${bsbgProductsId}, 'APPROVED', 'MANUAL', 1.0000)
        ON CONFLICT (bsbg_products_id) WHERE bsbg_products_id IS NOT NULL
        DO UPDATE SET
          brand_list_id = EXCLUDED.brand_list_id,
          dnmk_products_id = EXCLUDED.dnmk_products_id,
          mapping_status = 'APPROVED',
          match_method = 'MANUAL',
          confidence = 1.0000
      `)

      // Consolidate
      const mappingId = await findMappingId(dnmkProductsId, bsbgProductsId, null)
      if (mappingId) await consolidateToV0Products(mappingId, auth?.user?.email ?? null)

      return successResponse({ success: true }, context)
    }

    // ── Approve without match ────────────────────────────────────────────────
    if (dnmkProductsId && !ptdrkProductsId && !bsbgProductsId) {
      if (!brandListId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId required.', context })
      }

      // Remove any existing null-ptdrk row, then insert
      await db.$executeRaw(Prisma.sql`
        DELETE FROM v0.product_mappings
        WHERE dnmk_products_id = ${dnmkProductsId}
          AND ptdrk_products_id IS NULL AND bsbg_products_id IS NULL
      `)
      await db.$executeRaw(Prisma.sql`
        INSERT INTO v0.product_mappings
          (brand_list_id, dnmk_products_id, ptdrk_products_id, bsbg_products_id, mapping_status, match_method, confidence)
        VALUES (${brandListId}, ${dnmkProductsId}, NULL, NULL, 'APPROVED', 'NO_MATCH', 1.0000)
      `)

      const mappingId = await findMappingId(dnmkProductsId, null, null)
      if (mappingId) await consolidateToV0Products(mappingId, auth?.user?.email ?? null)

      return successResponse({ success: true }, context)
    }

    // ── Approve BSBG without DNMK match ──────────────────────────────────────
    if (bsbgProductsId && !dnmkProductsId && !ptdrkProductsId) {
      if (!brandListId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId required.', context })
      }

      // Remove existing bsbg-only placeholder, then insert
      await db.$executeRaw(Prisma.sql`
        DELETE FROM v0.product_mappings
        WHERE bsbg_products_id = ${bsbgProductsId}
          AND dnmk_products_id IS NULL
      `)
      await db.$executeRaw(Prisma.sql`
        INSERT INTO v0.product_mappings
          (brand_list_id, dnmk_products_id, bsbg_products_id, mapping_status, match_method, confidence)
        VALUES (${brandListId}, NULL, ${bsbgProductsId}, 'APPROVED', 'NO_MATCH', 1.0000)
      `)

      const mappingId = await findMappingId(null, bsbgProductsId, null)
      if (mappingId) await consolidateToV0Products(mappingId, auth?.user?.email ?? null)

      return successResponse({ success: true }, context)
    }

    return errorResponse({ status: 400, code: 'INVALID_COMBINATION', message: 'Geçersiz parametre kombinasyonu.', context })
  } catch (error) {
    console.error('[admin:products:match] Error:', error)
    return errorResponse({ status: 500, code: 'PRODUCT_MATCH_FAILED', message: 'İşlem yapılamadı.', context })
  }
}

// ─── PATCH — Undo/withdraw an approved match ──────────────────────────────────

export async function PATCH(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'admin:products:match',
    limit: 30,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user || auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Admin required.', context })
  }

  try {
    const body = await request.json()
    const { dnmkProductsId, bsbgProductsId } = body

    if (!dnmkProductsId && !bsbgProductsId) {
      return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'dnmkProductsId or bsbgProductsId required.', context })
    }

    const mapping = await db.$queryRaw<
      Array<{ id: bigint; ptdrk_products_id: number | null; bsbg_products_id: bigint | null; mapping_status: string }>
    >(Prisma.sql`
      SELECT id, ptdrk_products_id, bsbg_products_id, mapping_status
      FROM v0.product_mappings
      WHERE ${dnmkProductsId ? Prisma.sql`dnmk_products_id = ${dnmkProductsId}` : Prisma.sql`bsbg_products_id = ${bsbgProductsId}`}
      LIMIT 1
    `)

    if (mapping.length === 0) {
      return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Eşleşme bulunamadı.', context })
    }

    if (mapping[0].mapping_status !== 'APPROVED' && mapping[0].mapping_status !== 'APPROVED_MANUAL') {
      return errorResponse({ status: 400, code: 'INVALID_STATUS', message: 'Yalnızca onaylanmış eşleşmeler geri çekilebilir.', context })
    }

    // Delete the consolidated v0.product
    await db.$executeRaw(Prisma.sql`
      DELETE FROM v0.products WHERE product_mapping_id = ${mapping[0].id}
    `)

    const hasAnyLink = mapping[0].ptdrk_products_id !== null || mapping[0].bsbg_products_id !== null

    if (hasAnyLink) {
      // Has a link — revert status to PENDING (keep the link)
      await db.$executeRaw(Prisma.sql`
        UPDATE v0.product_mappings
        SET mapping_status = 'PENDING', approved_by = NULL, approved_at = NULL
        WHERE id = ${mapping[0].id}
      `)
    } else {
      // No links (NO_MATCH) — delete the mapping row
      await db.$executeRaw(Prisma.sql`
        DELETE FROM v0.product_mappings WHERE id = ${mapping[0].id}
      `)
    }

    return successResponse({ success: true }, context)
  } catch (error) {
    console.error('[admin:products:match] Error:', error)
    return errorResponse({ status: 500, code: 'UNDO_FAILED', message: 'Geri çekme işlemi yapılamadı.', context })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findMappingId(
  dnmkId: bigint | number | null | undefined,
  bsbgId: bigint | number | null | undefined,
  ptdrkId: number | null | undefined
): Promise<bigint | null> {
  if (dnmkId && ptdrkId) {
    const rows = await db.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM v0.product_mappings WHERE dnmk_products_id = ${dnmkId} AND ptdrk_products_id = ${ptdrkId} LIMIT 1
    `)
    return rows[0]?.id ?? null
  }
  if (dnmkId) {
    const rows = await db.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM v0.product_mappings WHERE dnmk_products_id = ${dnmkId} LIMIT 1
    `)
    return rows[0]?.id ?? null
  }
  if (bsbgId) {
    const rows = await db.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT id FROM v0.product_mappings WHERE bsbg_products_id = ${bsbgId} LIMIT 1
    `)
    return rows[0]?.id ?? null
  }
  return null
}
