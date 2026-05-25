import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr } from '@/lib/sql/dproduct-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr
} from '@/lib/sql/dproduct-details'

const VALID_STATUSES = ['all', 'PENDING', 'APPROVED', 'REJECTED', 'IGNORED'] as const
const VALID_MATCH_SIDES = ['all', 'matched', 'dinamik_only', 'pt_only'] as const

const VALID_SORT_COLUMNS: Record<string, string> = {
  dproducts_id: 'm.dproducts_id',
  product_id: 'm.ptproducts_id',
  mapping_status: 'm.mapping_status',
  normalized: 'm.normalized',
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
  const manufacturerIdStr = url.searchParams.get('manufacturerId')
  const matchSide = url.searchParams.get('matchSide') ?? 'all'
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
    whereClauses.push(Prisma.sql`p.ptbrands_id = ${manufacturerId}`)
  }
  if (matchSide === 'matched') {
    whereClauses.push(Prisma.sql`m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NOT NULL`)
  } else if (matchSide === 'dinamik_only') {
    whereClauses.push(Prisma.sql`m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NULL`)
  } else if (matchSide === 'pt_only') {
    whereClauses.push(Prisma.sql`m.dproducts_id IS NULL AND m.ptproducts_id IS NOT NULL`)
  }
  if (q) {
    const p = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    whereClauses.push(Prisma.sql`(COALESCE(d.stock_code,'') ILIKE ${p} OR COALESCE(d.stock_name,'') ILIKE ${p} OR COALESCE(${dproductBrandNameExpr},'') ILIKE ${p} OR COALESCE(p.title,'') ILIKE ${p} OR COALESCE(p.model,'') ILIKE ${p} OR COALESCE(mfr.name,'') ILIKE ${p})`)
  }
  const whereClause = whereClauses.length > 0 ? Prisma.sql`WHERE ${Prisma.join(whereClauses, ' AND ')}` : Prisma.sql``

  try {
    const countResult = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM v0.dpmatch m LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id ${whereClause}`
    )
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))

    const rows = await db.$queryRaw<
      Array<{
        id: number; dproducts_id: bigint | null; ptproducts_id: number | null
        normalized: string | null; mapping_status: string; match_method: string | null
        stock_code: string | null; stock_name: string | null; brand: string | null
        barcode_1: string | null; barcode_2: string | null; barcode_3: string | null
        part_no: string | null; price: string | null
        title: string | null; model: string | null; ref_no: string | null
        ptbrands_id: number | null; manufacturer_name: string | null
      }>
    >(Prisma.sql`
      SELECT m.id, m.dproducts_id, m.ptproducts_id, m.normalized, m.mapping_status, m.match_method,
             d.stock_code, d.stock_name, ${dproductBrandNameExpr} AS brand, d.barcode_1, d.barcode_2, d.barcode_3, d.part_no,
             ${dproductDetailsPriceExpr}::text AS price,
             p.title, p.model, p.ref_no, p.ptbrands_id, mfr.name AS manufacturer_name
      FROM v0.dpmatch m
      LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
      LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
      ${dproductDetailsJoin}
      LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
      LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
      ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `)

    const statusCounts = await db.$queryRaw<Array<{ mapping_status: string; count: bigint }>>(
      Prisma.sql`SELECT mapping_status, COUNT(*)::bigint AS count FROM v0.dpmatch GROUP BY mapping_status`
    )
    const statusMap = Object.fromEntries(statusCounts.map(r => [r.mapping_status, Number(r.count)]))

    return successResponse({
      rows: rows.map(r => ({
        id: r.id,
        dproductsId: r.dproducts_id?.toString() || null,
        productId: r.ptproducts_id,
        normalized: r.normalized,
        mappingStatus: r.mapping_status,
        matchMethod: r.match_method,
        dinamik: {
          stockCode: r.stock_code || null,
          stockName: r.stock_name || null,
          brand: r.brand || null,
          barcode1: r.barcode_1 || null,
          barcode2: r.barcode_2 || null,
          barcode3: r.barcode_3 || null,
          partNo: r.part_no || null,
          price: r.price ? String(r.price) : null,
        },
        parcatedarik: {
          title: r.title || '',
          model: r.model || null,
          refNo: r.ref_no || null,
          manufacturerId: r.ptbrands_id,
          manufacturerName: r.manufacturer_name || '',
        },
      })),
      pagination: { page, limit, total, pages },
      summary: {
        total: Number(statusMap['PENDING'] ?? 0) + Number(statusMap['APPROVED'] ?? 0) + Number(statusMap['REJECTED'] ?? 0) + Number(statusMap['IGNORED'] ?? 0),
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
    const apply = body.apply === true
    const env = Object.assign({}, process.env, { APPLY: apply ? 'true' : 'false' } as Record<string, string>)
    const { exec } = await import('child_process')
    const { promisify } = await import('util')
    const execAsync = promisify(exec)
    const { stdout: result } = await execAsync('bun scripts/generate-dinamik-parcatedarik-model-matches.ts', { env: env as NodeJS.ProcessEnv, timeout: 300_000, encoding: 'utf-8' })
    return successResponse({ message: apply ? 'Eşleştirmeler oluşturuldu.' : 'Kuru çalışma tamamlandı.', apply, output: result.slice(-3000) }, context)
  } catch (error) {
    console.error('[eslestirme:models:generate] Error:', error)
    return errorResponse({ status: 500, code: 'GENERATE_FAILED', message: 'Eşleştirme oluşturma başarısız.', context })
  }
}
