import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import { approvePendingPtOnlyDbrandsMatch } from '@/lib/admin/dnbrd-match-approve'
import { removeRedundantDbrandsMatchRows } from '@/lib/admin/dnbrd-match-cleanup'
import { revalidateAdminCatalogPaths } from '@/lib/admin/revalidate-catalog-paths'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const VALID_STATUSES = ['all', 'PENDING', 'APPROVED', 'REJECTED', 'IGNORED'] as const
const VALID_MATCH_SIDES = ['all', 'matched', 'dinamik_only', 'pt_only', 'bsbg_only'] as const

const VALID_SORT_COLUMNS: Record<string, string> = {
  normalizedName: 'cb.brand',
  mappingStatus: 'm.mapping_status',
  matchMethod: 'm.match_method',
  dinamikBrand: 'd.brand',
  ptName: 'pt.name',
  bsbgBrand: 'bs.brand',
}

function normalizeStatus(status: string): string {
  if (status === 'all') return 'all'
  return status.toUpperCase()
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
  const matchSide = url.searchParams.get('matchSide') ?? 'all'
  const sortCol = url.searchParams.get('sort')
  const sortDir = url.searchParams.get('sort_dir')?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'

  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return errorResponse({ status: 400, code: 'INVALID_STATUS', message: `Invalid status filter: ${status}`, context })
  }
  if (!VALID_MATCH_SIDES.includes(matchSide as typeof VALID_MATCH_SIDES[number])) {
    return errorResponse({ status: 400, code: 'INVALID_MATCH_SIDE', message: `Invalid matchSide: ${matchSide}`, context })
  }

  const orderColumn = sortCol && VALID_SORT_COLUMNS[sortCol] ? VALID_SORT_COLUMNS[sortCol] : 'cb.brand'
  const orderDir = sortDir === 'DESC' ? 'DESC' : 'ASC'

  try {
    const pattern = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null

    const whereClauses: Prisma.Sql[] = []
    if (pattern) {
      whereClauses.push(Prisma.sql`(cb.brand ILIKE ${pattern} OR d.brand ILIKE ${pattern} OR pt.name ILIKE ${pattern} OR bs.brand ILIKE ${pattern})`)
    }
    if (status !== 'all') {
      if (status === 'APPROVED') {
        whereClauses.push(Prisma.sql`m.mapping_status = 'APPROVED'`)
      } else {
        whereClauses.push(Prisma.sql`m.mapping_status = ${status}`)
      }
    }
    if (matchSide === 'matched') {
      whereClauses.push(Prisma.sql`m.dnmk_brands_id IS NOT NULL AND m.ptdrk_brands_id IS NOT NULL`)
    } else if (matchSide === 'dinamik_only') {
      whereClauses.push(Prisma.sql`m.dnmk_brands_id IS NOT NULL AND m.ptdrk_brands_id IS NULL AND m.bsbg_brands_id IS NULL`)
    } else if (matchSide === 'pt_only') {
      whereClauses.push(Prisma.sql`m.dnmk_brands_id IS NULL AND m.ptdrk_brands_id IS NOT NULL AND m.bsbg_brands_id IS NULL`)
    } else if (matchSide === 'bsbg_only') {
      whereClauses.push(Prisma.sql`m.dnmk_brands_id IS NULL AND m.ptdrk_brands_id IS NULL AND m.bsbg_brands_id IS NOT NULL`)
    }
    const whereClause = whereClauses.length > 0 ? Prisma.sql`(${Prisma.join(whereClauses, ' AND ')})` : Prisma.sql`1=1`

    const countResult = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS count FROM v0.brand_mappings m LEFT JOIN v0.brand_list cb ON cb.id = m.brand_list_id LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id LEFT JOIN v0.bsbg_brands bs ON bs.id = m.bsbg_brands_id WHERE ${whereClause}`
    )
    const total = Number(countResult[0]?.count ?? 0)
    const pages = Math.max(1, Math.ceil(total / limit))
    const offset = (page - 1) * limit

    const rows = await db.$queryRaw<
      Array<{
        id: number
        brand_list_id: number
        brand: string | null
        dinamik_brand: string | null
        pt_name: string | null
        bsbg_brand: string | null
        mapping_status: string | null
        match_method: string | null
      }>
    >(Prisma.sql`
      SELECT m.id,
             m.brand_list_id,
             cb.brand,
             d.brand AS dinamik_brand,
             pt.name AS pt_name,
             bs.brand AS bsbg_brand,
             m.mapping_status,
             m.match_method
      FROM v0.brand_mappings m
      LEFT JOIN v0.brand_list cb ON cb.id = m.brand_list_id
      LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      LEFT JOIN v0.bsbg_brands bs ON bs.id = m.bsbg_brands_id
      WHERE ${whereClause}
      ORDER BY ${Prisma.raw(orderColumn)} ${Prisma.raw(orderDir)} NULLS LAST, m.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `)

    const brandStatusCounts = await db.$queryRaw<
      Array<{ brand_status: string; count: bigint }>
    >(Prisma.sql`
      SELECT mapping_status AS brand_status, COUNT(DISTINCT brand_list_id) AS count
      FROM v0.brand_mappings
      GROUP BY mapping_status
    `)
    const brandStatusMap = Object.fromEntries(brandStatusCounts.map(r => [r.brand_status, Number(r.count)]))

    const totalBrandList = await db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*) AS count FROM v0.brand_list`
    )

    return successResponse({
      rows: rows.map(r => ({
        id: r.id,
        brandListId: r.brand_list_id,
        normalizedName: r.brand ?? '',
        dinamikBrand: r.dinamik_brand ?? '',
        ptName: r.pt_name ?? '',
        bsbgBrand: r.bsbg_brand ?? '',
        mappingStatus: r.mapping_status ?? '',
        matchMethod: r.match_method,
      })),
      pagination: { page, limit, total, pages },
      summary: {
        total: Number(totalBrandList[0]?.count ?? 0),
        approved: brandStatusMap['APPROVED'] ?? 0,
        pending: brandStatusMap['PENDING'] ?? 0,
        rejected: brandStatusMap['REJECTED'] ?? 0,
        ignored: brandStatusMap['IGNORED'] ?? 0,
      },
      filters: { q, status, matchSide },
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
        Prisma.sql`UPDATE v0.brand_mappings SET mapping_status = 'APPROVED' WHERE id IN (${Prisma.join(ids)}) AND mapping_status = 'PENDING'`
      )
      await removeRedundantDbrandsMatchRows()
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

    if (action === 'add-mapping') {
      const brandListId = body?.brandListId
      const ptdrkBrandsId = body?.parcatedarikManufacturerId
      const dnmkBrandsId = body?.dinamikBrandId
      const bsbgBrandsId = body?.bsbgBrandId

      if (!brandListId) {
        return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'brandListId gerekli.', context })
      }

      const canonical = await db.$queryRaw<Array<{ id: number }>>(
        Prisma.sql`SELECT id FROM v0.brand_list WHERE id = ${brandListId}`
      )
      if (!canonical || canonical.length === 0) {
        return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Marka bulunamadı.', context })
      }

      if (ptdrkBrandsId) {
        const mfrId = parseInt(String(ptdrkBrandsId), 10)
        if (isNaN(mfrId) || mfrId <= 0) {
          return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Geçersiz parcatedarikManufacturerId.', context })
        }
        const manufacturer = await db.$queryRaw<Array<{ id: number; name: string }>>(
          Prisma.sql`SELECT id, name FROM v0.ptdrk_brands WHERE id = ${mfrId}`
        )
        if (!manufacturer || manufacturer.length === 0) {
          return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Üretici bulunamadı.', context })
        }
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.brand_mappings (brand_list_id, ptdrk_brands_id, mapping_status, match_method)
          VALUES (${brandListId}, ${mfrId}, 'APPROVED', 'MANUAL')
          ON CONFLICT (brand_list_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id) DO NOTHING
        `)
      } else if (dnmkBrandsId) {
        const brandId = parseInt(String(dnmkBrandsId), 10)
        if (isNaN(brandId) || brandId <= 0) {
          return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Geçersiz dinamikBrandId.', context })
        }
        const brand = await db.$queryRaw<Array<{ id: number; brand: string }>>(
          Prisma.sql`SELECT id::int AS id, brand FROM v0.dnmk_brands WHERE id = ${brandId}`
        )
        if (!brand || brand.length === 0) {
          return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Dinamik marka bulunamadı.', context })
        }
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.brand_mappings (brand_list_id, dnmk_brands_id, mapping_status, match_method)
          VALUES (${brandListId}, ${brandId}, 'APPROVED', 'MANUAL')
          ON CONFLICT (brand_list_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id) DO NOTHING
        `)
      } else if (bsbgBrandsId) {
        const brandId = parseInt(String(bsbgBrandsId), 10)
        if (isNaN(brandId) || brandId <= 0) {
          return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Geçersiz bsbgBrandId.', context })
        }
        const brand = await db.$queryRaw<Array<{ id: number; brand: string }>>(
          Prisma.sql`SELECT id::int AS id, brand FROM v0.bsbg_brands WHERE id = ${brandId}`
        )
        if (!brand || brand.length === 0) {
          return errorResponse({ status: 404, code: 'NOT_FOUND', message: 'Başbuğ marka bulunamadı.', context })
        }
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.brand_mappings (brand_list_id, bsbg_brands_id, mapping_status, match_method)
          VALUES (${brandListId}, ${brandId}, 'APPROVED', 'MANUAL')
          ON CONFLICT (brand_list_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id) DO NOTHING
        `)
      } else {
        return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'parcatedarikManufacturerId, dinamikBrandId veya bsbgBrandId gerekli.', context })
      }

      await removeRedundantDbrandsMatchRows()
      revalidateAdminCatalogPaths()
      return successResponse({ brandListId, action: 'add-mapping', message: 'Eşleştirme oluşturuldu.' }, context)
    }

    return errorResponse({ status: 400, code: 'INVALID_ACTION', message: `Invalid action: ${action}`, context })
  } catch (error) {
    console.error('[eslestirme:brands:action] Error:', error)
    return errorResponse({ status: 500, code: 'INTERNAL_ERROR', message: 'İşlem sırasında hata oluştu.', context })
  }
}