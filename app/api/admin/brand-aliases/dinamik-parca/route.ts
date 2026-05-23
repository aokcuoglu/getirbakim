import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const VALID_STATUSES = ['all', 'pending', 'approved', 'rejected', 'ignored'] as const

function buildWhereClause(q: string, status: string): Prisma.Sql {
  const conditions: Prisma.Sql[] = []

  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`
    conditions.push(Prisma.sql`(a.dinamik_brand ILIKE ${pattern} OR m.name ILIKE ${pattern} OR a.normalized_dinamik_brand ILIKE ${pattern})`)
  }
  if (status !== 'all') {
    conditions.push(Prisma.sql`a.mapping_status = ${status.toUpperCase()}`)
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
      Prisma.sql`SELECT COUNT(*) AS count FROM public.dinamik_parca_brand_aliases a LEFT JOIN parcatedarik.manufacturer m ON m.id = a.parcatedarik_manufacturer_id WHERE ${whereClause}`
    )
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))
    const offset = (page - 1) * limit

    const rows = await db.$queryRaw<
      Array<{
        id: number
        dinamik_brand: string
        normalized_dinamik_brand: string
        parcatedarik_manufacturer_id: number
        manufacturer_name: string
        normalized_pc_manufacturer: string
        mapping_status: string
        confidence: number
        match_method: string | null
        approved_by: string | null
        approved_at: Date | null
        updated_at: Date | null
      }>
    >(Prisma.sql`
      SELECT a.id, a.dinamik_brand, a.normalized_dinamik_brand,
             a.parcatedarik_manufacturer_id,
             m.name AS manufacturer_name,
             a.normalized_pc_manufacturer,
             a.mapping_status, a.confidence, a.match_method,
             a.approved_by, a.approved_at, a.updated_at
      FROM public.dinamik_parca_brand_aliases a
      LEFT JOIN parcatedarik.manufacturer m ON m.id = a.parcatedarik_manufacturer_id
      WHERE ${whereClause}
      ORDER BY a.confidence DESC, a.dinamik_brand ASC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const statusCounts = await db.$queryRaw<
      Array<{ mapping_status: string; count: bigint }>
    >(Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM public.dinamik_parca_brand_aliases GROUP BY mapping_status`)

    const totalDinamikBrands = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(DISTINCT d.brand) AS count FROM dinamik.products d WHERE d.brand IS NOT NULL AND BTRIM(d.brand) <> ''`)

    const totalPcManufacturers = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(*) AS count FROM parcatedarik.manufacturer`)

    const matchedBrands = await db.$queryRaw<
      Array<{ count: bigint }>
    >(Prisma.sql`SELECT COUNT(DISTINCT dinamik_brand) AS count FROM public.dinamik_parca_brand_aliases WHERE mapping_status IN ('PENDING', 'APPROVED')`)

    const statusMap = Object.fromEntries(statusCounts.map(r => [r.mapping_status, Number(r.count)]))

    return successResponse({
      rows: rows.map(r => ({
        id: r.id,
        dinamikBrand: r.dinamik_brand,
        normalizedDinamikBrand: r.normalized_dinamik_brand,
        parcatedarikManufacturerId: r.parcatedarik_manufacturer_id,
        parcatedarikManufacturerName: r.manufacturer_name ?? '',
        normalizedPcManufacturer: r.normalized_pc_manufacturer,
        mappingStatus: r.mapping_status,
        confidence: Number(r.confidence),
        matchMethod: r.match_method,
        approvedBy: r.approved_by,
        approvedAt: r.approved_at?.toISOString() ?? null,
        updatedAt: r.updated_at?.toISOString() ?? null
      })),
      pagination: { page, limit, total, pages },
      summary: {
        total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        approved: statusMap['APPROVED'] ?? 0,
        pending: statusMap['PENDING'] ?? 0,
        rejected: statusMap['REJECTED'] ?? 0,
        ignored: statusMap['IGNORED'] ?? 0,
        totalDinamikBrands: Number(totalDinamikBrands[0]?.count ?? 0),
        totalPcManufacturers: Number(totalPcManufacturers[0]?.count ?? 0),
        matchedBrands: Number(matchedBrands[0]?.count ?? 0),
        unmatchedBrands: Number(totalDinamikBrands[0]?.count ?? 0) - Number(matchedBrands[0]?.count ?? 0)
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
      const minConfidence = body?.minConfidence ?? 0.85
      if (ids.length === 0 || ids.length > 500) {
        return errorResponse({
          status: 400,
          code: 'INVALID_IDS',
          message: '1-500 ID gerekli.',
          context
        })
      }
      const result = await db.$executeRaw(
        Prisma.sql`UPDATE public.dinamik_parca_brand_aliases
          SET mapping_status = 'APPROVED',
              approved_by = 'admin',
              approved_at = NOW(),
              updated_at = NOW()
          WHERE id IN (${Prisma.join(ids)})
            AND confidence >= ${minConfidence}
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