import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { approveDpmatchRows, approvePendingDpmatchWithoutBrandMatch } from '@/lib/admin/dpprd-normalized'
import { insertApprovedDpmatchForUnpairedBrands, populateDpmatch } from '@/lib/admin/dpprd-populate'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export const maxDuration = 300
import { dproductBrandNameExpr } from '@/lib/sql/dnprd-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr
} from '@/lib/sql/dnprd-details'

const VALID_STATUSES = ['all', 'PENDING', 'APPROVED', 'REJECTED', 'IGNORED'] as const
const VALID_MATCH_SIDES = ['all', 'matched', 'dinamik_only', 'pt_only'] as const
const VALID_MATCH_METHODS = ['all', 'EXACT_MATCH', 'MANUAL', 'NONE'] as const

const partNoSortExpr = `CASE WHEN m.dnmk_products_id IS NOT NULL THEN d.part_no WHEN m.bsbg_products_id IS NOT NULL THEN bs.part_no ELSE p.part_no END`

const VALID_SORT_COLUMNS: Record<string, string> = {
  dnmk_products_id: 'm.dnmk_products_id',
  product_id: 'm.ptdrk_products_id',
  mapping_status: 'm.mapping_status',
  part_no: partNoSortExpr,
}

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:list', limit: 120, windowMs: 60_000 })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const status = url.searchParams.get('status') ?? 'all'
  const dinamikBrand = (url.searchParams.get('dinamikBrand') ?? '').trim()
  const canonicalBrand = (url.searchParams.get('canonicalBrand') ?? '').trim()
  const bsbgBrand = (url.searchParams.get('bsbgBrand') ?? '').trim()
  const manufacturerIdStr = url.searchParams.get('manufacturerId')
  const matchSide = url.searchParams.get('matchSide') ?? 'all'
  const matchMethod = url.searchParams.get('matchMethod') ?? 'all'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 200)
  const offset = (page - 1) * limit
  const sortCol = url.searchParams.get('sort')
  const sortDirRaw = url.searchParams.get('sort_dir')?.toLowerCase()
  const sortDir = sortDirRaw === 'desc' ? 'DESC' : 'ASC'

  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return errorResponse({ status: 400, code: 'INVALID_STATUS', message: `Invalid status: ${status}`, context })
  }
  if (!VALID_MATCH_SIDES.includes(matchSide as typeof VALID_MATCH_SIDES[number])) {
    return errorResponse({ status: 400, code: 'INVALID_MATCH_SIDE', message: `Invalid matchSide: ${matchSide}`, context })
  }
  if (!VALID_MATCH_METHODS.includes(matchMethod as typeof VALID_MATCH_METHODS[number])) {
    return errorResponse({ status: 400, code: 'INVALID_MATCH_METHOD', message: `Invalid matchMethod: ${matchMethod}`, context })
  }

  const manufacturerId = manufacturerIdStr ? parseInt(manufacturerIdStr, 10) : null
  if (manufacturerIdStr && (manufacturerId == null || isNaN(manufacturerId) || manufacturerId <= 0)) {
    return errorResponse({ status: 400, code: 'INVALID_MANUFACTURER_ID', message: 'Geçersiz üretici ID.', context })
  }

  const orderColumn = sortCol && VALID_SORT_COLUMNS[sortCol] ? VALID_SORT_COLUMNS[sortCol] : 'm.id'
  const orderBy = Prisma.sql`${Prisma.raw(orderColumn)} ${Prisma.raw(sortDir)}`

  const whereClauses: Prisma.Sql[] = []
  if (status !== 'all') whereClauses.push(Prisma.sql`m.mapping_status = ${status.toUpperCase()}`)
  if (dinamikBrand) {
    whereClauses.push(Prisma.sql`BTRIM(LOWER(COALESCE(${dproductBrandNameExpr}, ''))) = BTRIM(LOWER(${dinamikBrand}))`)
  }
  if (manufacturerId) {
    whereClauses.push(Prisma.sql`p.ptdrk_brands_id = ${manufacturerId}`)
  }
  if (matchSide === 'matched') {
    whereClauses.push(Prisma.sql`m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NOT NULL`)
  } else if (matchSide === 'dinamik_only') {
    whereClauses.push(Prisma.sql`m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NULL`)
  } else if (matchSide === 'pt_only') {
    whereClauses.push(Prisma.sql`m.dnmk_products_id IS NULL AND m.ptdrk_products_id IS NOT NULL`)
  }
  if (canonicalBrand) {
    whereClauses.push(Prisma.sql`BTRIM(LOWER(COALESCE(cb.brand, ''))) = BTRIM(LOWER(${canonicalBrand}))`)
  }
  // brand_list always joined so UI can show canonical brand name
  const brandListJoin = Prisma.sql` LEFT JOIN v0.brand_list cb ON cb.id = m.brand_list_id`
  if (bsbgBrand) {
    whereClauses.push(Prisma.sql`BTRIM(LOWER(COALESCE(bb.brand, ''))) = BTRIM(LOWER(${bsbgBrand}))`)
  }
  if (matchMethod === 'EXACT_MATCH') {
    whereClauses.push(Prisma.sql`m.match_method = 'EXACT_MATCH'`)
  } else if (matchMethod === 'MANUAL' || matchMethod === 'MANUEL') {
    whereClauses.push(Prisma.sql`m.match_method = 'MANUAL'`)
  } else if (matchMethod === 'NONE') {
    whereClauses.push(Prisma.sql`m.match_method IS NULL`)
  }
  if (q) {
    const p = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    whereClauses.push(Prisma.sql`(COALESCE(d.stock_code,'') ILIKE ${p} OR COALESCE(d.stock_name,'') ILIKE ${p} OR COALESCE(${dproductBrandNameExpr},'') ILIKE ${p} OR COALESCE(p.title,'') ILIKE ${p} OR COALESCE(p.part_no,'') ILIKE ${p} OR COALESCE(mfr.name,'') ILIKE ${p})`)
  }
  const whereClause = whereClauses.length > 0 ? Prisma.sql`WHERE ${Prisma.join(whereClauses, ' AND ')}` : Prisma.sql``

  const bsbgJoin = bsbgBrand ? Prisma.sql` LEFT JOIN v0.bsbg_brands bb ON bb.id = bs.bsbg_brands_id` : Prisma.sql``

  const tableAlias = Prisma.sql`v0.product_mapping m`
  const joinClauses = Prisma.sql`LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id LEFT JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id LEFT JOIN v0.bsbg_products bs ON bs.id = m.bsbg_products_id LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id LEFT JOIN v0.ptdrk_brands mfr ON mfr.id = p.ptdrk_brands_id${brandListJoin}${bsbgJoin}`

  try {
    const countResult = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM ${tableAlias} ${joinClauses} ${whereClause}`
    )
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))

    const rows = await db.$queryRaw<
      Array<{
        id: number; dnmk_products_id: bigint | null; ptdrk_products_id: number | null; bsbg_products_id: bigint | null
        part_no: string | null; mapping_status: string; match_method: string | null
        brand_list_id: number | null; canonical_brand: string | null
        stock_code: string | null; stock_name: string | null; brand: string | null
        barcode_1: string | null; barcode_2: string | null; barcode_3: string | null
        dinamik_part_no: string | null; price: string | null
        bsbg_part_no: string | null; bsbg_malzeme_no: string | null
        title: string | null; model: string | null; ref_no: string | null
        ptdrk_brands_id: number | null; manufacturer_name: string | null
      }>
    >(Prisma.sql`
       SELECT m.id, m.dnmk_products_id, m.ptdrk_products_id, m.bsbg_products_id,
              CASE WHEN m.dnmk_products_id IS NOT NULL THEN d.part_no WHEN m.bsbg_products_id IS NOT NULL THEN bs.part_no ELSE p.part_no END AS part_no,
              m.mapping_status, m.match_method,
              m.brand_list_id, cb.brand AS canonical_brand,
               d.stock_code, d.stock_name, ${dproductBrandNameExpr} AS brand, d.barcode_1, d.barcode_2, d.barcode_3, d.part_no AS dinamik_part_no,
               ${dproductDetailsPriceExpr}::text AS price,
               bs.part_no AS bsbg_part_no, bs.malzeme_no AS bsbg_malzeme_no,
               p.title, p.part_no AS model, p.ref_no, p.ptdrk_brands_id, mfr.name AS manufacturer_name
       FROM ${tableAlias} ${joinClauses} ${dproductDetailsJoin}
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `)

    const statusCounts = await db.$queryRaw<Array<{ mapping_status: string; count: bigint }>>(
      Prisma.sql`SELECT m.mapping_status, COUNT(*)::bigint AS count FROM ${tableAlias} ${joinClauses} ${whereClause} GROUP BY m.mapping_status`
    )
    const statusMap = Object.fromEntries(statusCounts.map(r => [r.mapping_status, Number(r.count)]))
    const filteredTotal = Number(statusMap['PENDING'] ?? 0) + Number(statusMap['APPROVED'] ?? 0) + Number(statusMap['REJECTED'] ?? 0) + Number(statusMap['IGNORED'] ?? 0)

    return successResponse({
      rows: rows.map(r => ({
        id: r.id,
        dnprdId: r.dnmk_products_id?.toString() || null,
        productId: r.ptdrk_products_id,
        bsbgProductsId: r.bsbg_products_id?.toString() || null,
        part_no: r.part_no,
        mappingStatus: r.mapping_status,
        matchMethod: r.match_method,
        brandListId: r.brand_list_id,
        canonicalBrand: r.canonical_brand,
        dinamik: {
          stockCode: r.stock_code || null,
          stockName: r.stock_name || null,
          brand: r.brand || null,
          barcode1: r.barcode_1 || null,
          barcode2: r.barcode_2 || null,
          barcode3: r.barcode_3 || null,
          partNo: r.dinamik_part_no || null,
          price: r.price ? String(r.price) : null,
        },
        bsbg: {
          partNo: r.bsbg_part_no || null,
          malzemeNo: r.bsbg_malzeme_no || null,
        },
        parcatedarik: {
          title: r.title || '',
          model: r.model || null,
          refNo: r.ref_no || null,
          manufacturerId: r.ptdrk_brands_id,
          manufacturerName: r.manufacturer_name || '',
        },
      })),
      pagination: { page, limit, total, pages },
      summary: {
        total: filteredTotal,
        approved: statusMap['APPROVED'] ?? 0,
        pending: statusMap['PENDING'] ?? 0,
        rejected: statusMap['REJECTED'] ?? 0,
        ignored: statusMap['IGNORED'] ?? 0,
      },
      filters: { q, status, dinamikBrand: dinamikBrand || null, manufacturerId, matchSide },
    }, context)
  } catch (error) {
    console.error('[eslestirme:models:list] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Eşleştirmeler yüklenemedi.', context })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, { keyPrefix: 'eslestirme:models:generate', limit: 10, windowMs: 300_000 })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  try {
    const body = await request.json().catch(() => ({}))
    const action = body?.action ?? (body?.apply != null ? 'generate' : null)

    if (action === 'bulk-approve') {
      const ids: number[] = body?.ids ?? []
      if (ids.length === 0 || ids.length > 500) {
        return errorResponse({ status: 400, code: 'INVALID_IDS', message: '1-500 ID gerekli.', context })
      }
      const approved = await approveDpmatchRows(ids, { onlyPending: true, matchMethod: 'MANUAL' })
      return successResponse({ approved, message: `${approved} eşleştirme onaylandı.` }, context)
    }

    if (action === 'bulk-approve-no-brand') {
      const approved = await approvePendingDpmatchWithoutBrandMatch()
      return successResponse(
        {
          approved,
          message:
            approved > 0
              ? `${approved} markasız ürün eşleştirmesi onaylandı (karşı platform yok).`
              : 'Onaylanacak bekleyen markasız kayıt yok.',
        },
        context
      )
    }

    if (action === 'populate-unpaired-brands') {
      const apply = body?.apply === true
      const stats = await insertApprovedDpmatchForUnpairedBrands({ apply })
      return successResponse(
        {
          apply,
          stats,
          message: apply
            ? `${stats.unpairedDproductInserted} Dinamik-only, ${stats.unpairedProductInserted} PT-only eşleştirme eklendi.`
            : `${stats.unpairedDproductCandidates} Dinamik-only, ${stats.unpairedProductCandidates} PT-only eklenebilir.`,
        },
        context
      )
    }

    if (action === 'generate' || body?.apply != null) {
      const apply = body?.apply === true
      const stats = await populateDpmatch({
        apply,
        includePlaceholders: body?.includePlaceholders !== false,
        cleanInvalid: body?.cleanInvalid === true,
      })
      return successResponse(
        {
          message: apply ? 'Eşleştirmeler oluşturuldu.' : 'Kuru çalışma tamamlandı.',
          apply,
          stats,
        },
        context
      )
    }

    return errorResponse({ status: 400, code: 'INVALID_ACTION', message: `Invalid action: ${String(action)}`, context })
  } catch (error) {
    console.error('[eslestirme:models:generate] Error:', error)
    return errorResponse({ status: 500, code: 'GENERATE_FAILED', message: 'Eşleştirme oluşturma başarısız.', context })
  }
}
