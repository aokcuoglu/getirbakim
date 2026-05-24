import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const VALID_STATUSES = ['all', 'PENDING', 'APPROVED', 'REJECTED', 'IGNORED'] as const

const VALID_SORT_COLUMNS: Record<string, string> = {
  dproducts_id: 'm.dproducts_id',
  product_id: 'm.product_id',
  mapping_status: 'm.mapping_status',
}

function buildWhereClause(q: string, status: string): Prisma.Sql {
  const conditions: Prisma.Sql[] = []
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    conditions.push(Prisma.sql`(d.stock_code ILIKE ${pattern} OR d.stock_name ILIKE ${pattern} OR d.brand ILIKE ${pattern} OR p.title ILIKE ${pattern} OR p.model ILIKE ${pattern})`)
  }
  if (status !== 'all') {
    conditions.push(Prisma.sql`m.mapping_status = ${status.toUpperCase()}`)
  }
  if (conditions.length === 0) return Prisma.sql`1=1`
  return Prisma.sql`(${Prisma.join(conditions, ' AND ')})`
}

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:models:list',
    limit: 120,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const status = url.searchParams.get('status') ?? 'all'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 200)
  const offset = (page - 1) * limit
  const sortCol = url.searchParams.get('sort')
  const sortDirRaw = url.searchParams.get('sort_dir')?.toLowerCase()
  const sortDir = sortDirRaw === 'desc' ? 'DESC' : 'ASC'

  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return errorResponse({ status: 400, code: 'INVALID_STATUS', message: `Invalid status: ${status}`, context })
  }

  const orderColumn = sortCol && VALID_SORT_COLUMNS[sortCol] ? VALID_SORT_COLUMNS[sortCol] : 'm.id'
  const orderBy = Prisma.sql`${Prisma.raw(orderColumn)} ${Prisma.raw(sortDir)}`

  try {
    const whereClause = buildWhereClause(q, status)

    const countResult = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS count FROM parcatedarik.dpmatch m LEFT JOIN parcatedarik.dproducts d ON d.id = m.dproducts_id LEFT JOIN parcatedarik.product p ON p.id = m.product_id WHERE ${whereClause}`
    )
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))

    const rows = await db.$queryRaw<
      Array<{
        id: number; dproducts_id: bigint; product_id: number
        normalized: string | null; mapping_status: string; match_method: string | null
        stock_code: string; stock_name: string | null; brand: string | null
        barcode_1: string | null; barcode_2: string | null; barcode_3: string | null
        part_no: string | null; price: string | null
        title: string; model: string | null; ref_no: string | null
        manufacturer_id: number; manufacturer_name: string
      }>
    >(Prisma.sql`
      SELECT m.id, m.dproducts_id, m.product_id, m.normalized, m.mapping_status, m.match_method,
             d.stock_code, d.stock_name, d.brand, d.barcode_1, d.barcode_2, d.barcode_3, d.part_no, d.price::text,
             p.title, p.model, p.ref_no, p.manufacturer_id, mfr.name AS manufacturer_name
      FROM parcatedarik.dpmatch m
      LEFT JOIN parcatedarik.dproducts d ON d.id = m.dproducts_id
      LEFT JOIN parcatedarik.product p ON p.id = m.product_id
      LEFT JOIN parcatedarik.manufacturer mfr ON mfr.id = p.manufacturer_id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `)

    const statusCounts = await db.$queryRaw<Array<{ mapping_status: string; count: bigint }>>(
      Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM parcatedarik.dpmatch GROUP BY mapping_status`
    )
    const statusMap = Object.fromEntries(statusCounts.map(r => [r.mapping_status, Number(r.count)]))

    return successResponse({
      rows: rows.map(r => ({
        id: r.id,
        dproductsId: r.dproducts_id.toString(),
        productId: r.product_id,
        normalized: r.normalized,
        mappingStatus: r.mapping_status,
        matchMethod: r.match_method,
        dinamik: {
          stockCode: r.stock_code,
          stockName: r.stock_name,
          brand: r.brand,
          barcode1: r.barcode_1,
          barcode2: r.barcode_2,
          barcode3: r.barcode_3,
          partNo: r.part_no,
          price: r.price ? String(r.price) : null,
        },
        parcatedarik: {
          title: r.title,
          model: r.model,
          refNo: r.ref_no,
          manufacturerId: r.manufacturer_id,
          manufacturerName: r.manufacturer_name,
        },
      })),
      pagination: { page, limit, total, pages },
      summary: {
        total,
        approved: statusMap['APPROVED'] ?? 0,
        pending: statusMap['PENDING'] ?? 0,
        rejected: statusMap['REJECTED'] ?? 0,
        ignored: statusMap['IGNORED'] ?? 0,
      },
      filters: { q, status },
    }, context)
  } catch (error) {
    console.error('[eslestirme:models:list] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Eşleştirmeler yüklenemedi.', context })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:models:generate',
    limit: 10,
    windowMs: 300_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  try {
    const body = await request.json().catch(() => ({}))
    const apply = body.apply === true
    const env = Object.assign({}, process.env, { APPLY: apply ? 'true' : 'false' } as Record<string, string>)
    if (body.limit) env.LIMIT = String(body.limit)
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
