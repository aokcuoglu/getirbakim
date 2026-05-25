import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { approvePendingPtOnlyDbrandsMatch } from '@/lib/admin/dbrands-match-approve'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const VALID_STATUSES = ['all', 'PENDING', 'APPROVED', 'REJECTED', 'IGNORED'] as const
const VALID_MATCH_SIDES = ['all', 'matched', 'dinamik_only', 'pt_only'] as const

const VALID_SORT_COLUMNS: Record<string, string> = {
  dbrands_id: 'd.brand',
  dinamikBrand: 'd.brand',
  mapping_status: 'a.mapping_status',
  normalizedName: 'a.normalized',
  matchMethod: 'a.match_method',
}

function normalizeStatus(status: string): string {
  if (status === 'all') return 'all'
  return status.toUpperCase()
}

function buildWhereClause(input: {
  q: string
  status: string
  dinamikBrand: string
  manufacturerId: number | null
  matchSide: string
}): Prisma.Sql {
  const conditions: Prisma.Sql[] = []
  const status = normalizeStatus(input.status)

  if (input.q) {
    const pattern = `%${input.q.replace(/[%_\\]/g, '\\$&')}%`
    conditions.push(
      Prisma.sql`(COALESCE(d.brand, '') ILIKE ${pattern} OR m.name ILIKE ${pattern} OR a.normalized ILIKE ${pattern})`
    )
  }
  if (status !== 'all') {
    conditions.push(Prisma.sql`a.mapping_status = ${status}`)
  }
  if (input.dinamikBrand) {
    conditions.push(
      Prisma.sql`BTRIM(LOWER(COALESCE(d.brand, ''))) = BTRIM(LOWER(${input.dinamikBrand}))`
    )
  }
  if (input.manufacturerId) {
    conditions.push(Prisma.sql`a.ptbrands_id = ${input.manufacturerId}`)
  }
  if (input.matchSide === 'matched') {
    conditions.push(Prisma.sql`a.dbrands_id IS NOT NULL AND a.ptbrands_id IS NOT NULL`)
  } else if (input.matchSide === 'dinamik_only') {
    conditions.push(Prisma.sql`a.dbrands_id IS NOT NULL AND a.ptbrands_id IS NULL`)
  } else if (input.matchSide === 'pt_only') {
    conditions.push(Prisma.sql`a.dbrands_id IS NULL AND a.ptbrands_id IS NOT NULL`)
  }

  if (conditions.length === 0) return Prisma.sql`1=1`
  return Prisma.sql`(${Prisma.join(conditions, ' AND ')})`
}

export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:brands:list',
    limit: 100,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

  const url = new URL(request.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 200)
  const q = (url.searchParams.get('q') ?? '').trim()
  const status = normalizeStatus(url.searchParams.get('status') ?? 'all')
  const dinamikBrand = (url.searchParams.get('dinamikBrand') ?? '').trim()
  const manufacturerIdStr = url.searchParams.get('manufacturerId')
  const matchSide = url.searchParams.get('matchSide') ?? 'all'
  const sortCol = url.searchParams.get('sort')
  const sortDir = url.searchParams.get('sort_dir')?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'

  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return errorResponse({ status: 400, code: 'INVALID_STATUS', message: `Invalid status filter: ${status}`, context })
  }
  if (!VALID_MATCH_SIDES.includes(matchSide as typeof VALID_MATCH_SIDES[number])) {
    return errorResponse({ status: 400, code: 'INVALID_MATCH_SIDE', message: `Invalid matchSide: ${matchSide}`, context })
  }

  const manufacturerId = manufacturerIdStr ? parseInt(manufacturerIdStr, 10) : null
  if (manufacturerIdStr && (manufacturerId == null || isNaN(manufacturerId) || manufacturerId <= 0)) {
    return errorResponse({ status: 400, code: 'INVALID_MANUFACTURER_ID', message: 'Geçersiz üretici ID.', context })
  }

  const orderColumn = sortCol && VALID_SORT_COLUMNS[sortCol] ? VALID_SORT_COLUMNS[sortCol] : 'd.brand'
  const orderDir = sortCol && sortDir === 'ASC' ? 'ASC' : (sortCol ? 'DESC' : 'ASC')
  const orderBy =
    orderColumn === 'd.brand'
      ? Prisma.sql`d.brand ${Prisma.raw(orderDir)} NULLS LAST, a.id ASC`
      : Prisma.sql`${Prisma.raw(orderColumn)} ${Prisma.raw(orderDir)}, a.id ASC`

  try {
    const whereClause = buildWhereClause({
      q,
      status,
      dinamikBrand,
      manufacturerId,
      matchSide,
    })

    const countResult = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS count FROM v0.dbrands_match a LEFT JOIN v0.dbrands d ON d.id = a.dbrands_id LEFT JOIN v0.ptbrands m ON m.id = a.ptbrands_id WHERE ${whereClause}`
    )
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))
    const offset = (page - 1) * limit

    const rows = await db.$queryRaw<
      Array<{
        id: number; dinamik_brand: string | null; normalized: string
        ptbrands_id: number | null; manufacturer_name: string
        mapping_status: string; match_method: string | null
      }>
    >(Prisma.sql`
      SELECT a.id, d.brand AS dinamik_brand,
             a.normalized,
             a.ptbrands_id, m.name AS manufacturer_name,
             a.mapping_status, a.match_method
      FROM v0.dbrands_match a
      LEFT JOIN v0.dbrands d ON d.id = a.dbrands_id
      LEFT JOIN v0.ptbrands m ON m.id = a.ptbrands_id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT ${limit} OFFSET ${offset}
    `)

    const statusCounts = await db.$queryRaw<Array<{ mapping_status: string; count: bigint }>>(
      Prisma.sql`SELECT mapping_status, COUNT(*) AS count FROM v0.dbrands_match GROUP BY mapping_status`
    )

    const statusMap = Object.fromEntries(statusCounts.map(r => [r.mapping_status, Number(r.count)]))

    return successResponse({
      rows: rows.map(r => ({
        id: r.id,
        dinamikBrand: r.dinamik_brand ?? '',
        normalizedName: r.normalized ?? '',
        parcatedarikManufacturerId: r.ptbrands_id ?? null,
        parcatedarikManufacturerName: r.manufacturer_name ?? '',
        mappingStatus: r.mapping_status,
        matchMethod: r.match_method,
      })),
      pagination: { page, limit, total, pages },
      summary: {
        total,
        approved: statusMap['APPROVED'] ?? 0,
        pending: statusMap['PENDING'] ?? 0,
        rejected: statusMap['REJECTED'] ?? 0,
        ignored: statusMap['IGNORED'] ?? 0,
      },
      filters: { q, status, dinamikBrand: dinamikBrand || null, manufacturerId, matchSide },
    }, context)
  } catch (error) {
    console.error('[eslestirme:brands:list] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'Marka eşleştirmeleri yüklenirken hata oluştu.', context })
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:brands:generate',
    limit: 10,
    windowMs: 60_000,
  })
  if (limitedResponse) return limitedResponse
  if (!auth?.user) return errorResponse({ status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.', context })
  if (auth.user.role !== 'ADMIN') return errorResponse({ status: 403, code: 'ADMIN_REQUIRED', message: 'Admin access required.', context })

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
        return errorResponse({ status: 400, code: 'INVALID_IDS', message: '1-500 ID gerekli.', context })
      }
      const result = await db.$executeRaw(
        Prisma.sql`UPDATE v0.dbrands_match SET mapping_status = 'APPROVED' WHERE id IN (${Prisma.join(ids)}) AND mapping_status = 'PENDING'`
      )
      return successResponse({ approved: result, message: `${result} eşleştirme onaylandı.` }, context)
    }

    if (action === 'bulk-approve-pt-only') {
      const approved = await approvePendingPtOnlyDbrandsMatch()
      return successResponse(
        {
          approved,
          message:
            approved > 0
              ? `${approved} PT-only marka eşleştirmesi onaylandı (Dinamik karşılığı yok).`
              : 'Onaylanacak bekleyen PT-only kayıt yok.',
        },
        context
      )
    }

    return errorResponse({ status: 400, code: 'INVALID_ACTION', message: `Invalid action: ${action}`, context })
  } catch (error) {
    console.error('[eslestirme:brands:action] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'İşlem sırasında hata oluştu.', context })
  }
}
