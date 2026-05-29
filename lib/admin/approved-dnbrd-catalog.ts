import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type AdminApprovedBrandFilters = {
  q?: string
  logoStatus?: 'all' | 'missing' | 'has_logo'
  matchSide?: 'all' | 'matched' | 'dinamik_only' | 'pt_only'
  page?: number
  limit?: number
  sort?: string
  sortDir?: 'asc' | 'desc'
}

export type AdminApprovedBrandRow = {
  id: number
  dinamikBrand: string
  normalizedName: string
  parcatedarikManufacturerId: number | null
  parcatedarikManufacturerName: string
  mappingStatus: string
  matchMethod: string | null
  logoUrl: string | null
}

export type AdminApprovedBrandListResult = {
  rows: AdminApprovedBrandRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: { total: number; withLogo: number; missingLogo: number }
  filters: Required<
    Pick<AdminApprovedBrandFilters, 'q' | 'logoStatus' | 'matchSide'>
  > & { page: number; limit: number }
}

const VALID_SORT_COLUMNS: Record<string, string> = {
  dinamikBrand: 'd.brand',
  normalizedName: 'a.normalized_brand',
  matchMethod: 'a.match_method'
}

function normalizeFilters(input: AdminApprovedBrandFilters = {}) {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const logoStatus = input.logoStatus ?? 'all'
  const matchSide = input.matchSide ?? 'all'
  const sortDir = input.sortDir === 'desc' ? 'desc' : 'asc'

  return {
    q: (input.q ?? '').trim(),
    logoStatus:
      logoStatus === 'missing' || logoStatus === 'has_logo'
        ? logoStatus
        : ('all' as const),
    matchSide:
      matchSide === 'matched' ||
      matchSide === 'dinamik_only' ||
      matchSide === 'pt_only'
        ? matchSide
        : ('all' as const),
    page,
    limit,
    sort: input.sort,
    sortDir
  }
}

function buildWhereClause(
  filters: ReturnType<typeof normalizeFilters>
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`a.mapping_status = 'APPROVED'`]

  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`
    clauses.push(
      Prisma.sql`(COALESCE(d.brand, '') ILIKE ${pattern} OR m.name ILIKE ${pattern} OR a.normalized_brand ILIKE ${pattern})`
    )
  }
  if (filters.logoStatus === 'missing') {
    clauses.push(Prisma.sql`(d.logo_url IS NULL OR BTRIM(d.logo_url) = '')`)
  } else if (filters.logoStatus === 'has_logo') {
    clauses.push(Prisma.sql`d.logo_url IS NOT NULL AND BTRIM(d.logo_url) <> ''`)
  }
  if (filters.matchSide === 'matched') {
    clauses.push(
      Prisma.sql`a.dnmk_brands_id IS NOT NULL AND a.ptdrk_brands_id IS NOT NULL`
    )
  } else if (filters.matchSide === 'dinamik_only') {
    clauses.push(
      Prisma.sql`a.dnmk_brands_id IS NOT NULL AND a.ptdrk_brands_id IS NULL`
    )
  } else if (filters.matchSide === 'pt_only') {
    clauses.push(
      Prisma.sql`a.dnmk_brands_id IS NULL AND a.ptdrk_brands_id IS NOT NULL`
    )
  }

  return Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`
}

export async function listApprovedDbrandsForAdmin(
  input: AdminApprovedBrandFilters = {}
): Promise<AdminApprovedBrandListResult> {
  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit
  const whereClause = buildWhereClause(filters)
  const orderColumn =
    filters.sort && VALID_SORT_COLUMNS[filters.sort]
      ? VALID_SORT_COLUMNS[filters.sort]
      : 'd.brand'
  const orderDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC'
  const orderBy =
    orderColumn === 'd.brand'
      ? Prisma.sql`d.brand ${Prisma.raw(orderDir)} NULLS LAST, a.id ASC`
      : Prisma.sql`${Prisma.raw(orderColumn)} ${Prisma.raw(orderDir)}, a.id ASC`

  const fromJoin = Prisma.sql`
    FROM v0.dnmk_ptdrk_brands a
    LEFT JOIN v0.dnmk_brands d ON d.id = a.dnmk_brands_id
    LEFT JOIN v0.ptdrk_brands m ON m.id = a.ptdrk_brands_id
    ${whereClause}
  `

  const [countRows, summaryRows, rows] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count ${fromJoin}`
    ),
    db.$queryRaw<
      Array<{ total: bigint; with_logo: bigint; missing_logo: bigint }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE d.logo_url IS NOT NULL AND BTRIM(d.logo_url) <> ''
        )::bigint AS with_logo,
        COUNT(*) FILTER (
          WHERE d.logo_url IS NULL OR BTRIM(d.logo_url) = ''
        )::bigint AS missing_logo
      ${fromJoin}
    `),
    db.$queryRaw<
      Array<{
        id: number
        dinamik_brand: string | null
        normalized: string | null
        ptdrk_brands_id: number | null
        manufacturer_name: string | null
        mapping_status: string
        match_method: string | null
        logo_url: string | null
      }>
    >(Prisma.sql`
      SELECT
        a.id,
        d.brand AS dinamik_brand,
        a.normalized_brand,
        a.ptdrk_brands_id,
        m.name AS manufacturer_name,
        a.mapping_status,
        a.match_method,
        d.logo_url
      ${fromJoin}
      ORDER BY ${orderBy}
      LIMIT ${filters.limit} OFFSET ${offset}
    `)
  ])

  const total = Number(countRows[0]?.count ?? 0)
  const summary = summaryRows[0]

  return {
    rows: rows.map((r) => ({
      id: r.id,
      dinamikBrand: r.dinamik_brand ?? '',
      normalizedName: r.normalized ?? '',
      parcatedarikManufacturerId: r.ptdrk_brands_id,
      parcatedarikManufacturerName: r.manufacturer_name ?? '',
      mappingStatus: r.mapping_status,
      matchMethod: r.match_method,
      logoUrl: r.logo_url
    })),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.max(1, Math.ceil(total / filters.limit))
    },
    summary: {
      total: Number(summary?.total ?? 0),
      withLogo: Number(summary?.with_logo ?? 0),
      missingLogo: Number(summary?.missing_logo ?? 0)
    },
    filters: {
      q: filters.q,
      logoStatus: filters.logoStatus,
      matchSide: filters.matchSide,
      page: filters.page,
      limit: filters.limit
    }
  }
}

export async function getApprovedDbrandsMatchById(
  matchId: number
): Promise<AdminApprovedBrandRow | null> {
  const rows = await db.$queryRaw<
    Array<{
      id: number
      dinamik_brand: string | null
      normalized: string | null
      ptdrk_brands_id: number | null
      manufacturer_name: string | null
      mapping_status: string
      match_method: string | null
      logo_url: string | null
    }>
  >(Prisma.sql`
    SELECT
      a.id,
      d.brand AS dinamik_brand,
      a.normalized_brand,
      a.ptdrk_brands_id,
      m.name AS manufacturer_name,
      a.mapping_status,
      a.match_method,
      d.logo_url
    FROM v0.dnmk_ptdrk_brands a
    LEFT JOIN v0.dnmk_brands d ON d.id = a.dnmk_brands_id
    LEFT JOIN v0.ptdrk_brands m ON m.id = a.ptdrk_brands_id
    WHERE a.id = ${matchId} AND a.mapping_status = 'APPROVED'
    LIMIT 1
  `)

  const r = rows[0]
  if (!r) return null

  return {
    id: r.id,
    dinamikBrand: r.dinamik_brand ?? '',
    normalizedName: r.normalized ?? '',
    parcatedarikManufacturerId: r.ptdrk_brands_id,
    parcatedarikManufacturerName: r.manufacturer_name ?? '',
    mappingStatus: r.mapping_status,
    matchMethod: r.match_method,
    logoUrl: r.logo_url
  }
}

export async function setApprovedDbrandsMatchLogo(
  matchId: number,
  logoUrl: string
): Promise<boolean> {
  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE v0.dnmk_brands d
    SET logo_url = ${logoUrl}
    FROM v0.dnmk_ptdrk_brands a
    WHERE a.id = ${matchId}
      AND a.mapping_status = 'APPROVED'
      AND d.id = a.dnmk_brands_id
  `)
  return Number(updated) > 0
}
