import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type AdminApprovedBrandMapping = {
  mappingId: number
  dnmkBrandsId: string | null
  ptdrkBrandsId: number | null
  bsbgBrandsId: string | null
  dnmkBrand: string | null
  ptName: string | null
  bsbgBrand: string | null
  mappingStatus: string
  matchMethod: string | null
}

export type AdminApprovedBrandRow = {
  id: number // canonical id
  normalizedName: string // brand_list.normalized_brand
  logoUrl: string | null // brand_list.logo_url
  mappings: AdminApprovedBrandMapping[]
}

export type AdminApprovedBrandFilters = {
  q?: string
  logoStatus?: 'all' | 'missing' | 'has_logo'
  matchSide?: 'all' | 'matched' | 'dinamik_only' | 'pt_only'
  page?: number
  limit?: number
  sort?: string
  sortDir?: 'asc' | 'desc'
}

export type AdminApprovedBrandListResult = {
  rows: AdminApprovedBrandRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: { total: number; withLogo: number; missingLogo: number }
  filters: Required<Pick<AdminApprovedBrandFilters, 'q' | 'logoStatus'>> & {
    page: number
    limit: number
  }
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
      matchSide === 'matched' || matchSide === 'dinamik_only' || matchSide === 'pt_only'
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
  const clauses: Prisma.Sql[] = []

  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`
    clauses.push(
      Prisma.sql`cb.normalized_brand ILIKE ${pattern}`
    )
  }
  if (filters.logoStatus === 'missing') {
    clauses.push(Prisma.sql`(cb.logo_url IS NULL OR BTRIM(cb.logo_url) = '')`)
  } else if (filters.logoStatus === 'has_logo') {
    clauses.push(Prisma.sql`cb.logo_url IS NOT NULL AND BTRIM(cb.logo_url) <> ''`)
  }

  if (clauses.length === 0) {
    return Prisma.sql`1=1`
  }
  return Prisma.sql`${Prisma.join(clauses, ' AND ')}`
}

export async function listApprovedDbrandsForAdmin(
  input: AdminApprovedBrandFilters = {}
): Promise<AdminApprovedBrandListResult> {
  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit
  const whereClause = buildWhereClause(filters)
  const orderDir = filters.sortDir === 'desc' ? 'DESC' : 'ASC'
  const orderBy = Prisma.sql`cb.normalized_brand ${Prisma.raw(orderDir)}`

  // Count and summary
  const [countRows, summaryRows] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM v0.brand_list cb WHERE ${whereClause}`
    ),
    db.$queryRaw<
      Array<{ total: bigint; with_logo: bigint; missing_logo: bigint }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE cb.logo_url IS NOT NULL AND BTRIM(cb.logo_url) <> '')::bigint AS with_logo,
        COUNT(*) FILTER (WHERE cb.logo_url IS NULL OR BTRIM(cb.logo_url) = '')::bigint AS missing_logo
      FROM v0.brand_list cb
      WHERE ${whereClause}
    `)
  ])

  const total = Number(countRows[0]?.count ?? 0)
  const summary = summaryRows[0]

  // Fetch canonical brands with mappings
  const canonicalRows = await db.$queryRaw<
    Array<{
      id: number
      normalized_brand: string
      logo_url: string | null
    }>
  >(Prisma.sql`
    SELECT id, normalized_brand, logo_url
    FROM v0.brand_list cb
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${filters.limit} OFFSET ${offset}
  `)

  // Fetch mappings for these canonical brands in batch
  const canonicalIds = canonicalRows.map((r) => r.id)
  let mappingsRaw: Array<{
    brand_list_id: number
    mapping_id: number
    dnmk_brands_id: bigint | null
    ptdrk_brands_id: number | null
    bsbg_brands_id: bigint | null
    dnmk_brand: string | null
    pt_name: string | null
    bsbg_brand: string | null
    mapping_status: string
    match_method: string | null
  }> = []

  if (canonicalIds.length > 0) {
    mappingsRaw = await db.$queryRaw`
      SELECT
        m.brand_list_id,
        m.id AS mapping_id,
        m.dnmk_brands_id,
        m.ptdrk_brands_id,
        m.bsbg_brands_id,
        d.brand AS dnmk_brand,
        pt.name AS pt_name,
        bs.brand AS bsbg_brand,
        m.mapping_status,
        m.match_method
      FROM v0.brand_mappings m
      LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
      LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
      LEFT JOIN v0.bsbg_brands bs ON bs.id = m.bsbg_brands_id
      WHERE m.brand_list_id IN (${Prisma.join(canonicalIds)})
      ORDER BY m.id
    `
  }

  // Group mappings by canonical brand id
  const mappingsByBrandId = new Map<number, AdminApprovedBrandMapping[]>()
  for (const m of mappingsRaw) {
    const arr = mappingsByBrandId.get(m.brand_list_id) ?? []
    arr.push({
      mappingId: m.mapping_id,
      dnmkBrandsId: m.dnmk_brands_id != null ? String(m.dnmk_brands_id) : null,
      ptdrkBrandsId: m.ptdrk_brands_id,
      bsbgBrandsId: m.bsbg_brands_id != null ? String(m.bsbg_brands_id) : null,
      dnmkBrand: m.dnmk_brand,
      ptName: m.pt_name,
      bsbgBrand: m.bsbg_brand,
      mappingStatus: m.mapping_status,
      matchMethod: m.match_method
    })
    mappingsByBrandId.set(m.brand_list_id, arr)
  }

  const rows: AdminApprovedBrandRow[] = canonicalRows.map((r) => ({
    id: r.id,
    normalizedName: r.normalized_brand,
    logoUrl: r.logo_url,
    mappings: mappingsByBrandId.get(r.id) ?? []
  }))

  return {
    rows,
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
      normalized_brand: string
      logo_url: string | null
    }>
  >(Prisma.sql`
    SELECT id, normalized_brand, logo_url
    FROM v0.brand_list cb
    WHERE cb.id = ${matchId}
    LIMIT 1
  `)

  const r = rows[0]
  if (!r) return null

  const mappings = await db.$queryRaw<
    Array<{
      mapping_id: number
      dnmk_brands_id: bigint | null
      ptdrk_brands_id: number | null
      bsbg_brands_id: bigint | null
      dnmk_brand: string | null
      pt_name: string | null
      bsbg_brand: string | null
      mapping_status: string
      match_method: string | null
    }>
  >(Prisma.sql`
    SELECT
      m.id AS mapping_id,
      m.dnmk_brands_id,
      m.ptdrk_brands_id,
      m.bsbg_brands_id,
      d.brand AS dnmk_brand,
      pt.name AS pt_name,
      bs.brand AS bsbg_brand,
      m.mapping_status,
      m.match_method
    FROM v0.brand_mappings m
    LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
    LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
    LEFT JOIN v0.bsbg_brands bs ON bs.id = m.bsbg_brands_id
    WHERE m.brand_list_id = ${matchId}
    ORDER BY m.id
  `)

  return {
    id: r.id,
    normalizedName: r.normalized_brand,
    logoUrl: r.logo_url,
    mappings: mappings.map((m) => ({
      mappingId: m.mapping_id,
      dnmkBrandsId: m.dnmk_brands_id != null ? String(m.dnmk_brands_id) : null,
      ptdrkBrandsId: m.ptdrk_brands_id,
      bsbgBrandsId: m.bsbg_brands_id != null ? String(m.bsbg_brands_id) : null,
      dnmkBrand: m.dnmk_brand,
      ptName: m.pt_name,
      bsbgBrand: m.bsbg_brand,
      mappingStatus: m.mapping_status,
      matchMethod: m.match_method
    }))
  }
}

export async function setApprovedDbrandsMatchLogo(
  canonicalId: number,
  logoUrl: string
): Promise<boolean> {
  const updated = await db.$executeRaw(Prisma.sql`
    UPDATE v0.brand_list
    SET logo_url = ${logoUrl}
    WHERE id = ${canonicalId}
  `)
  return Number(updated) > 0
}

export async function mergeCanonicalBrands(
  sourceIds: number[],
  targetId: number
): Promise<{ success: boolean; error?: string }> {
  if (sourceIds.length === 0 || sourceIds.includes(targetId)) {
    return { success: false, error: 'Invalid source or target' }
  }

  try {
    // Wrap in transaction
    await db.$transaction(async (tx) => {
      // 1. Move all mappings from source brands to target
      await tx.$executeRaw(Prisma.sql`
        UPDATE v0.brand_mappings
        SET brand_list_id = ${targetId}
        WHERE brand_list_id IN (${Prisma.join(sourceIds)})
      `)

      // 2. Remove duplicate mappings (keep the one with lowest id for each unique combo)
      await tx.$executeRaw`
        DELETE FROM v0.brand_mappings a
        WHERE a.id > (
          SELECT MIN(b.id)
          FROM v0.brand_mappings b
          WHERE b.brand_list_id = a.brand_list_id
            AND b.dnmk_brands_id IS NOT DISTINCT FROM a.dnmk_brands_id
            AND b.ptdrk_brands_id IS NOT DISTINCT FROM a.ptdrk_brands_id
        )
      `

      // 3. If target has no logo but a source has one, copy it
      const targetLogo = await tx.$queryRaw<Array<{ logo_url: string | null }>>(
        Prisma.sql`SELECT logo_url FROM v0.brand_list WHERE id = ${targetId}`
      )
      if (!targetLogo[0]?.logo_url) {
        const sourceLogos = await tx.$queryRaw<
          Array<{ logo_url: string }>
        >(
          Prisma.sql`
            SELECT logo_url
            FROM v0.brand_list
            WHERE id IN (${Prisma.join(sourceIds)})
              AND logo_url IS NOT NULL
            LIMIT 1
          `
        )
        if (sourceLogos.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE v0.brand_list
            SET logo_url = ${sourceLogos[0].logo_url}
            WHERE id = ${targetId}
          `)
        }
      }

      // 4. Delete source canonical brands
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM v0.brand_list WHERE id IN (${Prisma.join(sourceIds)})`
      )
    })

    return { success: true }
  } catch (e) {
    console.error('[mergeCanonicalBrands] Error:', e)
    return { success: false, error: 'Merge failed' }
  }
}
