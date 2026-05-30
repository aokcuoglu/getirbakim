import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { getDinamikBrandMatchStats } from '@/lib/admin/dinamik-brand-match-stats'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const VALID_STATUSES = ['all', 'pending', 'approved', 'rejected', 'ignored'] as const

function buildWhereClause(q: string, status: string): Prisma.Sql {
  const conditions: Prisma.Sql[] = []

  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    conditions.push(
      Prisma.sql`(COALESCE(d.brand, '') ILIKE ${pattern} OR pt.name ILIKE ${pattern} OR cb.normalized_brand ILIKE ${pattern})`
    )
  }
  if (status !== 'all') {
    conditions.push(Prisma.sql`m.mapping_status = ${status.toUpperCase()}`)
  }

  if (conditions.length === 0) {
    return Prisma.sql`1=1`
  }
  return Prisma.sql`(${Prisma.join(conditions, ' AND ')})`
}

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'brand-aliases:list',
    limit: 100,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })
  }

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 200)
  const q = (url.searchParams.get('q') ?? '').trim()
  const status = url.searchParams.get('status') ?? 'all'

  if (!VALID_STATUSES.includes(status as any)) {
    return errorResponse({
      status: 400,
      code: 'INVALID_STATUS',
      message: `Invalid status filter: ${status}`,
      context
    })
  }

  try {
    const whereClause = buildWhereClause(q, status)

    const countResult = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS count FROM v0.brand_list cb LEFT JOIN v0.brand_mappings m ON m.brand_list_id = cb.id LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id WHERE ${whereClause}`
    )
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))
    const offset = (page - 1) * limit

    const rows = await db.$queryRaw<
      Array<{
        id: number
        dinamik_brand: string | null
        normalized_brand: string
        ptdrk_brands_id: number | null
        manufacturer_name: string | null
        mapping_status: string | null
        match_method: string | null
      }>
    >(Prisma.sql`
      SELECT m.id, d.brand AS dinamik_brand,
             cb.normalized_brand,
             m.ptdrk_brands_id,
             pt.name AS manufacturer_name,
             m.mapping_status, m.match_method
      FROM v0.brand_list cb
      LEFT JOIN v0.brand_mappings m ON m.brand_list_id = cb.id
      LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      WHERE ${whereClause}
      ORDER BY d.brand ASC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `)

    const statusCounts = await db.$queryRaw<
      Array<{ mapping_status: string; count: bigint }>
    >(Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM v0.brand_mappings GROUP BY mapping_status`)

    const brandStats = await getDinamikBrandMatchStats()

    const statusMap = Object.fromEntries(statusCounts.map(r => [r.mapping_status, Number(r.count)]))

    return successResponse({
      rows: rows.map(r => ({
        id: r.id,
        dinamikBrand: r.dinamik_brand ?? '',
        normalizedName: r.normalized_brand ?? '',
        parcatedarikManufacturerId: r.ptdrk_brands_id,
        parcatedarikManufacturerName: r.manufacturer_name ?? '',
        mappingStatus: r.mapping_status ?? '',
        matchMethod: r.match_method,
      })),
      pagination: { page, limit, total, pages },
      summary: {
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        approved: statusMap['APPROVED'] ?? 0,
        pending: statusMap['PENDING'] ?? 0,
        rejected: statusMap['REJECTED'] ?? 0,
        ignored: statusMap['IGNORED'] ?? 0,
        totalDinamikBrands: brandStats.totalDinamikBrands,
        totalPcManufacturers: brandStats.totalPcManufacturers,
        matchedBrands: brandStats.matchedBrands,
        unmatchedBrands: brandStats.unmatchedBrands,
      },
      filters: { q, status }
    }, context)
  } catch (error) {
    console.error('[brand-aliases:list] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Marka eşleştirmeleri yüklenirken hata oluştu.',
      context
    })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'brand-aliases:generate',
    limit: 10,
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
    const action = body?.action

    if (action === 'generate') {
      const { execSync } = await import('child_process')
      const limit = body?.limit ? `LIMIT=${body.limit}` : ''
      const cmd = `bun scripts/generate-dinamik-parca-brand-aliases.ts APPLY=true ${limit}`
      execSync(cmd, { timeout: 300_000, stdio: 'pipe' })
      return successResponse({ message: 'Marka eşleştirmeleri oluşturuldu.' }, context)
    }

    if (action === 'bulk-approve') {
      const ids: number[] = body?.ids ?? []
      if (ids.length === 0 || ids.length > 500) {
        return errorResponse({
          status: 400,
          code: 'INVALID_IDS',
          message: '1-500 ID gerekli.',
          context
        })
      }
      const result = await db.$executeRaw(
        Prisma.sql`UPDATE v0.brand_mappings
          SET mapping_status = 'APPROVED'
          WHERE id IN (${Prisma.join(ids)})
            AND mapping_status = 'PENDING'`
      )
      return successResponse({ approved: result, message: `${result} eşleştirme onaylandı.` }, context)
    }

    return errorResponse({
      status: 400,
      code: 'INVALID_ACTION',
      message: `Invalid action: ${action}`,
      context
    })
  } catch (error) {
    console.error('[brand-aliases:action] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'İşlem sırasında hata oluştu.',
      context
    })
  }
}
