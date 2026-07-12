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
        SELECT DISTINCT pp.id, pp.product_id, pp.part_no, pp.title
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

    // ── Match-dialog: trigram-suggested ptdrk candidates for a dnmk product ─
    // Returns ptdrk_products under the approved paired brand for the given
    // brand_list_id, ranked by pg_trgm similarity(dnmk.part_no, ptdrk.part_no)
    // over normalized ([A-Z0-9]) values. Threshold default 0.5.
    if (target === 'ptdrk_suggest' && brandListId) {
      const dnmkProductsId = url.searchParams.get('dnmkProductsId')
      const simThreshold = parseFloat(url.searchParams.get('threshold') ?? '0.5') || 0.5
      const suggestLimit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)))
      if (!dnmkProductsId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'dnmkProductsId required.', context })
      }
      const dnmkIdNum = BigInt(dnmkProductsId)
      const brandListIdNum = parseInt(brandListId)

      const rows = await db.$queryRaw<
        Array<{ id: number; product_id: string; part_no: string | null; title: string; similarity: number }>
      >(Prisma.sql`
        WITH dnmk AS (
          SELECT id, part_no,
            NULLIF(UPPER(REGEXP_REPLACE(COALESCE(part_no, ''), '[^A-Z0-9]', '', 'gi')), '') AS d_norm
          FROM v0.dnmk_products
          WHERE id = ${dnmkIdNum}
        )
        SELECT pp.id, pp.product_id, pp.part_no, pp.title,
          ROUND(similarity(d.d_norm, NULLIF(UPPER(REGEXP_REPLACE(COALESCE(pp.part_no, ''), '[^A-Z0-9]', '', 'gi')), ''))::numeric, 3) AS similarity
        FROM dnmk d
        CROSS JOIN v0.ptdrk_products pp
        WHERE d.d_norm IS NOT NULL
          AND pp.ptdrk_brands_id = (
            SELECT bm.ptdrk_brands_id
            FROM v0.brand_mappings bm
            WHERE bm.brand_list_id = ${brandListIdNum}
              AND bm.ptdrk_brands_id IS NOT NULL
              AND bm.mapping_status = 'APPROVED'
            LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM v0.product_mappings pm
            WHERE pm.ptdrk_products_id = pp.id
          )
          AND similarity(d.d_norm, NULLIF(UPPER(REGEXP_REPLACE(COALESCE(pp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')) >= ${simThreshold}
        ORDER BY similarity DESC
        LIMIT ${suggestLimit}
      `)

      return successResponse({ rows }, context)
    }

    // ── Bulk pre-approve: trigram-suggested (dnmk ↔ ptdrk) pairs for a brand ─
    // Returns candidate pairs across ALL unmatched dnmk products under the
    // given brand_list_id, each with its best trigram-matched ptdrk product.
    // Used by the "Toplu Eşleştir" review modal — admin selects which pairs to
    // approve. Does NOT write anything.
    if (target === 'bulk_suggest' && brandListId) {
      const simThreshold = parseFloat(url.searchParams.get('threshold') ?? '0.5') || 0.5
      const pairLimit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '200', 10)))
      const perDnmkLimit = Math.min(10, Math.max(1, parseInt(url.searchParams.get('perDnmk') ?? '1', 10)))
      const pairPage = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
      const pairOffset = (pairPage - 1) * pairLimit
      const brandListIdNum = parseInt(brandListId)

      const cte = Prisma.sql`
        WITH unmatched_dnmk AS (
          SELECT dp.id, dp.stock_code, dp.part_no, dp.stock_name, dp.dnmk_brands_id,
            NULLIF(UPPER(REGEXP_REPLACE(COALESCE(dp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '') AS d_norm
          FROM v0.dnmk_products dp
          JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
          WHERE bm.brand_list_id = ${brandListIdNum}
            AND bm.mapping_status = 'APPROVED'
            AND NOT EXISTS (
              SELECT 1 FROM v0.product_mappings pm
              WHERE pm.dnmk_products_id = dp.id
                AND pm.mapping_status = 'APPROVED'
            )
            AND NULLIF(UPPER(REGEXP_REPLACE(COALESCE(dp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '') IS NOT NULL
        ),
        ptdrk_pool AS (
          SELECT pp.id, pp.product_id, pp.part_no, pp.title, pp.ptdrk_brands_id,
            NULLIF(UPPER(REGEXP_REPLACE(COALESCE(pp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '') AS p_norm
          FROM v0.ptdrk_products pp
          WHERE pp.ptdrk_brands_id = (
            SELECT bm.ptdrk_brands_id
            FROM v0.brand_mappings bm
            WHERE bm.brand_list_id = ${brandListIdNum}
              AND bm.ptdrk_brands_id IS NOT NULL
              AND bm.mapping_status = 'APPROVED'
            LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM v0.product_mappings pm
            WHERE pm.ptdrk_products_id = pp.id
              AND pm.mapping_status = 'APPROVED'
          )
          AND NULLIF(UPPER(REGEXP_REPLACE(COALESCE(pp.part_no, ''), '[^A-Z0-9]', '', 'gi')), '') IS NOT NULL
        ),
        scored AS (
          SELECT
            d.id AS dnmk_id, d.stock_code AS dnmk_stock_code, d.part_no AS dnmk_part_no, d.stock_name AS dnmk_stock_name,
            pp.id AS ptdrk_id, pp.product_id AS ptdrk_product_id, pp.part_no AS ptdrk_part_no, pp.title AS ptdrk_title,
            similarity(d.d_norm, pp.p_norm) AS sim
          FROM unmatched_dnmk d
          CROSS JOIN ptdrk_pool pp
          WHERE similarity(d.d_norm, pp.p_norm) >= ${simThreshold}
        ),
        ranked AS (
          SELECT *,
            ROW_NUMBER() OVER (PARTITION BY dnmk_id ORDER BY sim DESC) AS rn
          FROM scored
        )
      `

      const totalResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        ${cte}
        SELECT COUNT(*)::bigint AS n
        FROM ranked r
        WHERE r.rn <= ${perDnmkLimit}
      `)
      const total = Number(totalResult[0]?.n ?? 0)

      const rows = await db.$queryRaw<
        Array<{
          dnmk_id: string
          dnmk_stock_code: string
          dnmk_part_no: string | null
          dnmk_stock_name: string | null
          ptdrk_id: string
          ptdrk_product_id: string
          ptdrk_part_no: string | null
          ptdrk_title: string
          brand_list_id: string
          brand_name: string
          similarity: number
        }>
      >(Prisma.sql`
        ${cte}
        SELECT
          r.dnmk_id::text, r.dnmk_stock_code, r.dnmk_part_no, r.dnmk_stock_name,
          r.ptdrk_id::text, r.ptdrk_product_id, r.ptdrk_part_no, r.ptdrk_title,
          ${brandListIdNum}::text AS brand_list_id,
          bl.brand AS brand_name,
          ROUND(r.sim::numeric, 3) AS similarity
        FROM ranked r
        JOIN v0.brand_list bl ON bl.id = ${brandListIdNum}
        WHERE r.rn <= ${perDnmkLimit}
        ORDER BY r.sim DESC
        LIMIT ${pairLimit} OFFSET ${pairOffset}
      `)

      return successResponse({
        rows,
        pagination: { page: pairPage, limit: pairLimit, total, pages: Math.ceil(total / pairLimit) }
      }, context)
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
        SELECT DISTINCT bp.id, bp.malzeme_no, bp.part_no, bp.aciklama
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
        SELECT DISTINCT dp.id, dp.stock_code, dp.part_no, dp.stock_name
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

    // ── DNMK product detail (row-click modal) ────────────────────────────────
    // Returns the full dnmk_products row (+ cost, brand) plus every mapping it
    // participates in, exposing the linked ptdrk_products.ref_no — the value the
    // DNMK↔PT matching exists to carry over into dnmk_products.oem_no.
    if (target === 'dnmk_detail') {
      const dnmkProductsId = url.searchParams.get('dnmkProductsId')
      if (!dnmkProductsId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'dnmkProductsId required.', context })
      }
      const dnmkIdNum = BigInt(dnmkProductsId)

      const productRows = await db.$queryRaw<
        Array<{
          id: bigint
          stock_code: string
          stock_name: string | null
          part_no: string | null
          oem_no: string | null
          barcode_1: string | null
          barcode_2: string | null
          barcode_3: string | null
          image_url: string | null
          is_passive: boolean
          created_at: Date
          updated_at: Date
          last_seen_at: Date
          brand: string
          price: Prisma.Decimal | null
          stock_qty: number | null
          campaign_rate: Prisma.Decimal | null
        }>
      >(Prisma.sql`
        SELECT
          dp.id, dp.stock_code, dp.stock_name, dp.part_no, dp.oem_no,
          dp.barcode_1, dp.barcode_2, dp.barcode_3, dp.image_url,
          dp.is_passive, dp.created_at, dp.updated_at, dp.last_seen_at,
          db.brand,
          dc.price, dc.stock_qty, dc.campaign_rate
        FROM v0.dnmk_products dp
        JOIN v0.dnmk_brands db ON db.id = dp.dnmk_brands_id
        LEFT JOIN v0.dnmk_cost dc ON dc.dnmk_products_id = dp.id
        WHERE dp.id = ${dnmkIdNum}
        LIMIT 1
      `)

      if (productRows.length === 0) {
        return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Ürün bulunamadı.', context })
      }
      const p = productRows[0]

      const mappingRows = await db.$queryRaw<
        Array<{
          mapping_id: bigint
          mapping_status: string
          brand_list_name: string | null
          ptdrk_id: number | null
          ptdrk_product_id: string | null
          ptdrk_part_no: string | null
          ptdrk_title: string | null
          ptdrk_ref_no: string | null
        }>
      >(Prisma.sql`
        SELECT
          pm.id AS mapping_id,
          pm.mapping_status,
          bl.brand AS brand_list_name,
          pp.id AS ptdrk_id,
          pp.product_id AS ptdrk_product_id,
          pp.part_no AS ptdrk_part_no,
          pp.title AS ptdrk_title,
          pp.ref_no AS ptdrk_ref_no
        FROM v0.product_mappings pm
        LEFT JOIN v0.ptdrk_products pp ON pp.id = pm.ptdrk_products_id
        LEFT JOIN v0.brand_list bl ON bl.id = pm.brand_list_id
        WHERE pm.dnmk_products_id = ${dnmkIdNum}
        ORDER BY pm.id
      `)

      return successResponse({
        product: {
          id: Number(p.id),
          stock_code: p.stock_code,
          stock_name: p.stock_name,
          part_no: p.part_no,
          oem_no: p.oem_no,
          barcode_1: p.barcode_1,
          barcode_2: p.barcode_2,
          barcode_3: p.barcode_3,
          image_url: p.image_url,
          is_passive: p.is_passive,
          created_at: p.created_at,
          updated_at: p.updated_at,
          last_seen_at: p.last_seen_at,
          brand: p.brand,
          price: p.price != null ? Number(p.price) : null,
          stock_qty: p.stock_qty,
          campaign_rate: p.campaign_rate != null ? Number(p.campaign_rate) : null
        },
        mappings: mappingRows.map((m) => ({
          mapping_id: Number(m.mapping_id),
          mapping_status: m.mapping_status,
          brand_list_name: m.brand_list_name,
          ptdrk_id: m.ptdrk_id != null ? Number(m.ptdrk_id) : null,
          ptdrk_product_id: m.ptdrk_product_id,
          ptdrk_part_no: m.ptdrk_part_no,
          ptdrk_title: m.ptdrk_title,
          ptdrk_ref_no: m.ptdrk_ref_no
        }))
      }, context)
    }

    // ── Source: DNMK products ────────────────────────────────────────────────
    if (source === 'dnmk') {
      const searchFilter = q
        ? Prisma.sql`AND (bl.brand ILIKE ${'%' + q + '%'} OR dp.stock_code ILIKE ${'%' + q + '%'} OR dp.part_no ILIKE ${'%' + q + '%'} OR dp.stock_name ILIKE ${'%' + q + '%'} OR dp.barcode_1 ILIKE ${'%' + q + '%'} OR dp.barcode_2 ILIKE ${'%' + q + '%'} OR dp.barcode_3 ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      let brandFilter = Prisma.empty
      if (brandListId) {
        brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      }

      // 'matched' = APPROVED with an actual PT/BSBG link. 'approved_no_match' =
      // APPROVED but deliberately without any link (both ids NULL). Both share
      // mapping_status='APPROVED'; the NULL-ness of the link columns is what
      // distinguishes "approved with a match" from "approved without a match".
      let matchSideFilter = Prisma.empty
      if (matchSide === 'matched') {
        matchSideFilter = Prisma.sql`AND pm.mapping_status = 'APPROVED' AND (pm.ptdrk_products_id IS NOT NULL OR pm.bsbg_products_id IS NOT NULL)`
      } else if (matchSide === 'approved_no_match') {
        matchSideFilter = Prisma.sql`AND pm.mapping_status = 'APPROVED' AND pm.ptdrk_products_id IS NULL AND pm.bsbg_products_id IS NULL`
      } else if (matchSide === 'pending') {
        matchSideFilter = Prisma.sql`AND pm.mapping_status = 'PENDING'`
      } else if (matchSide === 'unmatched') {
        matchSideFilter = Prisma.sql`AND pm.id IS NULL`
      }

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT dp.id)::bigint AS n
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.dnmk_products_id = dp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ${matchSideFilter}
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
          mapping_status: string | null
          has_match: boolean | null
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (dp.id)
          dp.id,
          dp.stock_code,
          dp.part_no,
          dp.stock_name,
          bl.brand,
          bm.brand_list_id,
          pm.mapping_status,
          (pm.ptdrk_products_id IS NOT NULL OR pm.bsbg_products_id IS NOT NULL) AS has_match
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.dnmk_products_id = dp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ${matchSideFilter}
        ORDER BY dp.id, bl.brand, dp.stock_code
        LIMIT ${limit} OFFSET ${offset}
      `)

      const summaryResult = await db.$queryRaw<Array<{ total: bigint; matched: bigint; noMatch: bigint; pending: bigint; unmatched: bigint }>>(Prisma.sql`
        SELECT
          COUNT(DISTINCT dp.id)::bigint AS total,
          COUNT(DISTINCT dp.id) FILTER (WHERE pm.mapping_status = 'APPROVED' AND (pm.ptdrk_products_id IS NOT NULL OR pm.bsbg_products_id IS NOT NULL))::bigint AS matched,
          COUNT(DISTINCT dp.id) FILTER (WHERE pm.mapping_status = 'APPROVED' AND pm.ptdrk_products_id IS NULL AND pm.bsbg_products_id IS NULL)::bigint AS "noMatch",
          COUNT(DISTINCT dp.id) FILTER (WHERE pm.mapping_status = 'PENDING')::bigint AS pending,
          COUNT(DISTINCT dp.id) FILTER (WHERE pm.id IS NULL)::bigint AS unmatched
        FROM v0.dnmk_products dp
        JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.dnmk_products_id = dp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
      `)
      const summary = summaryResult[0]
      if (!summary) throw new Error('summary query failed')

      return successResponse({
        rows: rows.map((r) => ({ id: Number(r.id), stock_code: r.stock_code, part_no: r.part_no, stock_name: r.stock_name, brand: r.brand, brand_list_id: r.brand_list_id, mapping_status: r.mapping_status, has_match: r.has_match ?? false })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { total: Number(summary.total), matched: Number(summary.matched), noMatch: Number(summary.noMatch), pending: Number(summary.pending), unmatched: Number(summary.unmatched) }
      }, context)
    }

    // ── Source: BSBG products ────────────────────────────────────────────────
    if (source === 'bsbg') {
      const searchFilter = q
        ? Prisma.sql`AND (bl.brand ILIKE ${'%' + q + '%'} OR bp.malzeme_no ILIKE ${'%' + q + '%'} OR bp.part_no ILIKE ${'%' + q + '%'} OR bp.aciklama ILIKE ${'%' + q + '%'} OR bp.oem_no ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      let brandFilter = Prisma.empty
      if (brandListId) {
        brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      }

      let matchSideFilter = Prisma.empty
      if (matchSide === 'matched') {
        matchSideFilter = Prisma.sql`AND pm.mapping_status = 'APPROVED'`
      } else if (matchSide === 'pending') {
        matchSideFilter = Prisma.sql`AND pm.mapping_status = 'PENDING'`
      } else if (matchSide === 'unmatched') {
        matchSideFilter = Prisma.sql`AND pm.id IS NULL`
      }

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT bp.id)::bigint AS n
        FROM v0.bsbg_products bp
        JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.bsbg_products_id = bp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ${matchSideFilter}
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
          mapping_status: string | null
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (bp.id)
          bp.id,
          bp.malzeme_no,
          bp.part_no,
          bp.aciklama,
          bl.brand,
          bm.brand_list_id,
          pm.mapping_status
        FROM v0.bsbg_products bp
        JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.bsbg_products_id = bp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ${matchSideFilter}
        ORDER BY bp.id, bl.brand, bp.malzeme_no
        LIMIT ${limit} OFFSET ${offset}
      `)

      const summaryResult = await db.$queryRaw<Array<{ total: bigint; matched: bigint; pending: bigint; unmatched: bigint }>>(Prisma.sql`
        SELECT
          COUNT(DISTINCT bp.id)::bigint AS total,
          COUNT(DISTINCT bp.id) FILTER (WHERE pm.mapping_status = 'APPROVED')::bigint AS matched,
          COUNT(DISTINCT bp.id) FILTER (WHERE pm.mapping_status = 'PENDING')::bigint AS pending,
          COUNT(DISTINCT bp.id) FILTER (WHERE pm.id IS NULL)::bigint AS unmatched
        FROM v0.bsbg_products bp
        JOIN v0.brand_mappings bm ON bm.bsbg_brands_id = bp.bsbg_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.bsbg_products_id = bp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
      `)
      const summary = summaryResult[0]
      if (!summary) throw new Error('summary query failed')

      return successResponse({
        rows: rows.map((r) => ({ id: Number(r.id), malzeme_no: r.malzeme_no, part_no: r.part_no, aciklama: r.aciklama, brand: r.brand, brand_list_id: r.brand_list_id, mapping_status: r.mapping_status })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { total: Number(summary.total), matched: Number(summary.matched), pending: Number(summary.pending), unmatched: Number(summary.unmatched) }
      }, context)
    }

    // ── Source: PTDRK products ───────────────────────────────────────────────
    if (source === 'ptdrk') {
      const searchFilter = q
        ? Prisma.sql`AND (bl.brand ILIKE ${'%' + q + '%'} OR pp.product_id ILIKE ${'%' + q + '%'} OR pp.part_no ILIKE ${'%' + q + '%'} OR pp.title ILIKE ${'%' + q + '%'} OR pp.ref_no ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      let brandFilter = Prisma.empty
      if (brandListId) {
        brandFilter = Prisma.sql`AND bm.brand_list_id = ${parseInt(brandListId)}`
      }

      let matchSideFilter = Prisma.empty
      if (matchSide === 'matched') {
        matchSideFilter = Prisma.sql`AND pm.mapping_status = 'APPROVED'`
      } else if (matchSide === 'pending') {
        matchSideFilter = Prisma.sql`AND pm.mapping_status = 'PENDING'`
      } else if (matchSide === 'unmatched') {
        matchSideFilter = Prisma.sql`AND pm.id IS NULL`
      }

      const countResult = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COUNT(DISTINCT pp.id)::bigint AS n
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.ptdrk_products_id = pp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ${matchSideFilter}
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
          mapping_status: string | null
        }>
      >(Prisma.sql`
        SELECT DISTINCT ON (pp.id)
          pp.id,
          pp.product_id,
          pp.part_no,
          pp.title,
          bl.brand,
          bm.brand_list_id,
          pm.mapping_status
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.ptdrk_products_id = pp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
        ${matchSideFilter}
        ORDER BY pp.id, bl.brand, pp.part_no
        LIMIT ${limit} OFFSET ${offset}
      `)

      const summaryResult = await db.$queryRaw<Array<{ total: bigint; matched: bigint; pending: bigint; unmatched: bigint }>>(Prisma.sql`
        SELECT
          COUNT(DISTINCT pp.id)::bigint AS total,
          COUNT(DISTINCT pp.id) FILTER (WHERE pm.mapping_status = 'APPROVED')::bigint AS matched,
          COUNT(DISTINCT pp.id) FILTER (WHERE pm.mapping_status = 'PENDING')::bigint AS pending,
          COUNT(DISTINCT pp.id) FILTER (WHERE pm.id IS NULL)::bigint AS unmatched
        FROM v0.ptdrk_products pp
        JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = pp.ptdrk_brands_id
        JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
        LEFT JOIN v0.product_mappings pm ON pm.ptdrk_products_id = pp.id
        WHERE 1=1
        ${searchFilter}
        ${brandFilter}
      `)
      const summary = summaryResult[0]
      if (!summary) throw new Error('summary query failed')

      return successResponse({
        rows: rows.map((r) => ({ ...r })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        summary: { total: Number(summary.total), matched: Number(summary.matched), pending: Number(summary.pending), unmatched: Number(summary.unmatched) }
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
    const { dnmkProductsId, bsbgProductsId, ptdrkProductsId, ptdrkProductsIds, brandListId, action } = body

    // ── Bulk approve without match: every unmatched DNMK product under a brand ─
    // Inserts an APPROVED row with NULL ptdrk/bsbg for every DNMK product that
    // has no product_mappings row yet (scoped to the selected brand + optional
    // search query, mirroring the DNMK list). These rows are "approved without a
    // match": mapping_status='APPROVED' but both link ids NULL — distinguishable
    // from real matches (which carry a non-null ptdrk_products_id/bsbg_products_id).
    if (action === 'bulk_approve_no_match') {
      if (!brandListId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId required.', context })
      }
      const brandListIdNum = parseInt(brandListId)
      if (!Number.isFinite(brandListIdNum) || brandListIdNum <= 0) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId invalid.', context })
      }

      const q = typeof body.q === 'string' ? body.q.trim() : ''
      const searchFilter = q
        ? Prisma.sql`AND (bl.brand ILIKE ${'%' + q + '%'} OR dp.stock_code ILIKE ${'%' + q + '%'} OR dp.part_no ILIKE ${'%' + q + '%'} OR dp.stock_name ILIKE ${'%' + q + '%'} OR dp.barcode_1 ILIKE ${'%' + q + '%'} OR dp.barcode_2 ILIKE ${'%' + q + '%'} OR dp.barcode_3 ILIKE ${'%' + q + '%'})`
        : Prisma.empty

      try {
        const result = await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.product_mappings
            (brand_list_id, dnmk_products_id, ptdrk_products_id, bsbg_products_id, mapping_status)
          SELECT DISTINCT ON (dp.id)
            bm.brand_list_id, dp.id, NULL, NULL, 'APPROVED'
          FROM v0.dnmk_products dp
          JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = dp.dnmk_brands_id
          JOIN v0.brand_list bl ON bl.id = bm.brand_list_id
          LEFT JOIN v0.product_mappings pm ON pm.dnmk_products_id = dp.id
          WHERE pm.id IS NULL
            AND bm.brand_list_id = ${brandListIdNum}
            ${searchFilter}
          ORDER BY dp.id
        `)
        return successResponse({ success: true, approved: Number(result) }, context)
      } catch (error) {
        console.error('[admin:products:match] bulk_approve_no_match error:', error)
        return errorResponse({ status: 500, code: 'BULK_APPROVE_NO_MATCH_FAILED', message: 'Eşleşmesiz toplu onay yapılamadı.', context })
      }
    }

    // ── Bulk approve pairs: many (dnmk ↔ ptdrk) pairs (single tx) ───────────
    // Accepts an array of {dnmkId, ptdrkId} pairs and a brandListId, writes
    // APPROVED product_mappings in one transaction. v0.products consolidation
    // is intentionally NOT triggered — all APPROVED mappings are transferred
    // in a single final batch pass once every brand's matching is complete.
    if (action === 'bulk_approve_pairs') {
      const pairs: Array<{ dnmkId: number; ptdrkId: number }> = body.pairs
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'pairs[] required.', context })
      }
      if (!brandListId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId required.', context })
      }

      const brandListIdNum = parseInt(brandListId)
      const cleanPairs = pairs
        .map((p) => ({ dnmkId: BigInt(p.dnmkId), ptdrkId: Number(p.ptdrkId) }))
        .filter((p) => p.dnmkId > BigInt(0) && Number.isFinite(p.ptdrkId) && p.ptdrkId > 0)

      if (cleanPairs.length === 0) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'pairs[] must contain at least one valid pair.', context })
      }

      try {
        await db.$transaction(async (tx) => {
          for (const p of cleanPairs) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO v0.product_mappings
                (brand_list_id, dnmk_products_id, ptdrk_products_id, mapping_status)
              VALUES (${brandListIdNum}, ${p.dnmkId}, ${p.ptdrkId}, 'APPROVED')
              ON CONFLICT (dnmk_products_id, ptdrk_products_id) WHERE ptdrk_products_id IS NOT NULL
              DO UPDATE SET mapping_status = 'APPROVED'
            `)
          }
        })
        return successResponse({ success: true, approved: cleanPairs.length }, context)
      } catch (error) {
        console.error('[admin:products:match] bulk_approve_pairs error:', error)
        return errorResponse({ status: 500, code: 'BULK_APPROVE_FAILED', message: 'Toplu onay yapılamadı.', context })
      }
    }

    // ── Bulk link: DNMK ↔ many PT (single transaction, all-or-nothing) ────────
    if (action === 'bulk_link_dnmk_pt') {
      if (!dnmkProductsId || !Array.isArray(ptdrkProductsIds) || ptdrkProductsIds.length === 0) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'dnmkProductsId and ptdrkProductsIds[] required.', context })
      }
      if (!brandListId) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'brandListId required.', context })
      }

      const approvedBy = auth?.user?.email ?? null
      const dnmkIdBig = BigInt(dnmkProductsId)
      const brandListIdNum = parseInt(brandListId)
      const ptdrkIdList: number[] = ptdrkProductsIds.map((id: unknown) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)

      if (ptdrkIdList.length === 0) {
        return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'ptdrkProductsIds[] must contain at least one valid id.', context })
      }

      try {
        await db.$transaction(async (tx) => {
          for (const ptdrkId of ptdrkIdList) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO v0.product_mappings
                (brand_list_id, dnmk_products_id, ptdrk_products_id, mapping_status)
              VALUES (${brandListIdNum}, ${dnmkIdBig}, ${ptdrkId}, 'APPROVED')
              ON CONFLICT (dnmk_products_id, ptdrk_products_id) WHERE ptdrk_products_id IS NOT NULL
              DO UPDATE SET mapping_status = 'APPROVED'
            `)
          }
        })

        // Consolidate each created/updated mapping into v0.products (outside the
        // tx because consolidateToV0Products uses the shared db client, which is
        // acceptable — DB writes here are idempotent upserts keyed by
        // product_mapping_id).
        let linkedCount = 0
        for (const ptdrkId of ptdrkIdList) {
          const mappingId = await findMappingId(dnmkIdBig, null, ptdrkId)
          if (mappingId) {
            await consolidateToV0Products(mappingId, approvedBy)
            linkedCount++
          }
        }

        return successResponse({ success: true, linked: linkedCount }, context)
      } catch (error) {
        console.error('[admin:products:match] bulk_link_dnmk_pt error:', error)
        return errorResponse({ status: 500, code: 'BULK_LINK_FAILED', message: 'Toplu eşleştirme yapılamadı.', context })
      }
    }

    if (!dnmkProductsId && !bsbgProductsId) {
      return errorResponse({ status: 400, code: 'MISSING_FIELDS', message: 'dnmkProductsId or bsbgProductsId required.', context })
    }

    // ── Actions for PENDING mappings ─────────────────────────────────────────
    if (action) {
      if (action === 'approve_pending') {
        if (dnmkProductsId) {
          await db.$executeRaw(Prisma.sql`
            UPDATE v0.product_mappings
            SET mapping_status = 'APPROVED'
            WHERE dnmk_products_id = ${dnmkProductsId}
              AND mapping_status = 'PENDING'
          `)
        } else if (bsbgProductsId) {
          await db.$executeRaw(Prisma.sql`
            UPDATE v0.product_mappings
            SET mapping_status = 'APPROVED'
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
            SET mapping_status = 'IGNORED'
            WHERE dnmk_products_id = ${dnmkProductsId}
              AND mapping_status = 'PENDING'
          `)
        } else if (bsbgProductsId) {
          await db.$executeRaw(Prisma.sql`
            UPDATE v0.product_mappings
            SET mapping_status = 'IGNORED'
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
          (brand_list_id, dnmk_products_id, ptdrk_products_id, mapping_status)
        VALUES (${brandListId}, ${dnmkProductsId}, ${ptdrkProductsId}, 'APPROVED')
        ON CONFLICT (dnmk_products_id, ptdrk_products_id) WHERE ptdrk_products_id IS NOT NULL
        DO UPDATE SET mapping_status = 'APPROVED'
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
          (brand_list_id, dnmk_products_id, bsbg_products_id, mapping_status)
        VALUES (${brandListId}, ${dnmkProductsId}, ${bsbgProductsId}, 'APPROVED')
        ON CONFLICT (bsbg_products_id) WHERE bsbg_products_id IS NOT NULL
        DO UPDATE SET
          brand_list_id = EXCLUDED.brand_list_id,
          dnmk_products_id = EXCLUDED.dnmk_products_id,
          mapping_status = 'APPROVED'
      `)

      // Consolidate
      const mappingId = await findMappingId(dnmkProductsId, bsbgProductsId, null)
      if (mappingId) await consolidateToV0Products(mappingId, auth?.user?.email ?? null)

      return successResponse({ success: true }, context)
    }

    // ── Approve without match ────────────────────────────────────────────────
    // Marks the DNMK product as APPROVED without a PT/BSBG link. v0.products
    // consolidation is intentionally NOT triggered here — all APPROVED mappings
    // are transferred to v0.products in a single final batch pass once every
    // brand's matching is complete.
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
          (brand_list_id, dnmk_products_id, ptdrk_products_id, bsbg_products_id, mapping_status)
        VALUES (${brandListId}, ${dnmkProductsId}, NULL, NULL, 'APPROVED')
      `)

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
          (brand_list_id, dnmk_products_id, bsbg_products_id, mapping_status)
        VALUES (${brandListId}, NULL, ${bsbgProductsId}, 'APPROVED')
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
        SET mapping_status = 'PENDING'
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
