import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type AdminApprovedBrandMapping = {
  mappingId: number
  dnmkBrandsId: string | null
  bsbgBrandsId: string | null
  dnmkBrand: string | null
  ptName: string | null
  bsbgBrand: string | null
  mappingStatus: string
  matchMethod: string | null
}

export type AdminApprovedBrandRow = {
  id: number // canonical id
  normalizedName: string // brand_list.brand
  logoUrl: string | null // brand_list.logo_url
  mappings: AdminApprovedBrandMapping[]
}

export type AdminApprovedBrandFilters = {
  q?: string
  logoStatus?: 'all' | 'missing' | 'has_logo'
  matchSide?: 'all' | 'matched' | 'dinamik_only' | 'basbug_only' | 'pending' | 'unmatched'
  page?: number
  limit?: number
  sort?: string
  sortDir?: 'asc' | 'desc'
}

export type AdminApprovedBrandListResult = {
  rows: AdminApprovedBrandRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: { total: number; withLogo: number; missingLogo: number }
  filters: Required<Pick<AdminApprovedBrandFilters, 'q' | 'logoStatus' | 'matchSide'>> & {
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
      matchSide === 'matched' || matchSide === 'dinamik_only' || matchSide === 'basbug_only' || matchSide === 'pending' || matchSide === 'unmatched'
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
      Prisma.sql`cb.brand ILIKE ${pattern}`
    )
  }
  if (filters.logoStatus === 'missing') {
    clauses.push(Prisma.sql`(cb.logo_url IS NULL OR BTRIM(cb.logo_url) = '')`)
  } else if (filters.logoStatus === 'has_logo') {
    clauses.push(Prisma.sql`cb.logo_url IS NOT NULL AND BTRIM(cb.logo_url) <> ''`)
  }

  if (filters.matchSide === 'matched') {
    // En az bir mapping'te dnmk veya BSBG bağlantısı var
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND (m.dinamik_brand_id IS NOT NULL OR m.basbug_brand_id IS NOT NULL)
      )
    `)
  } else if (filters.matchSide === 'dinamik_only') {
    // Sadece dnmk tarafı dolu olan mapping var, başbuğ tarafı hiç dolu değil
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND m.dinamik_brand_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND m.basbug_brand_id IS NOT NULL
      )
    `)
  } else if (filters.matchSide === 'basbug_only') {
    // Sadece başbuğ tarafı dolu olan mapping var, dnmk tarafı hiç dolu değil
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND m.basbug_brand_id IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND m.dinamik_brand_id IS NOT NULL
      )
    `)
  } else if (filters.matchSide === 'pending') {
    // En az bir PENDING mapping var (BSBG-only olanları hariç tut)
    clauses.push(Prisma.sql`
      EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND m.mapping_status = 'PENDING'
          AND (m.dinamik_brand_id IS NOT NULL OR m.basbug_brand_id IS NOT NULL)
      )
    `)
  } else if (filters.matchSide === 'unmatched') {
    // Hiçbir tedarikçiye APPROVED bağı olmayan kanonik markalar
    clauses.push(Prisma.sql`
      NOT EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND (m.dinamik_brand_id IS NOT NULL OR m.basbug_brand_id IS NOT NULL)
          AND m.mapping_status = 'APPROVED'
      )
      AND NOT EXISTS (
        SELECT 1 FROM catalog.brand_mappings m
        WHERE m.brand_id = cb.id
          AND m.basbug_brand_id IS NOT NULL
      )
    `)
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
  const orderBy = Prisma.sql`cb.brand ${Prisma.raw(orderDir)}`

  // Count for pagination (respects filters)
  const countRows = await db.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT COUNT(*)::bigint AS count FROM catalog.brands cb WHERE ${whereClause}`
  )

  // Summary is always unfiltered — KPI cards must not change when filters are applied
  const summaryRows = await db.$queryRaw<
    Array<{ total: bigint; with_logo: bigint; missing_logo: bigint }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE cb.logo_url IS NOT NULL AND BTRIM(cb.logo_url) <> '')::bigint AS with_logo,
      COUNT(*) FILTER (WHERE cb.logo_url IS NULL OR BTRIM(cb.logo_url) = '')::bigint AS missing_logo
    FROM catalog.brands cb
  `)

  const total = Number(countRows[0]?.count ?? 0)
  const summary = summaryRows[0]

  // Fetch canonical brands with mappings
  const canonicalRows = await db.$queryRaw<
    Array<{
      id: number
      brand: string
      logo_url: string | null
    }>
  >(Prisma.sql`
    SELECT id, brand, logo_url
    FROM catalog.brands cb
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${filters.limit} OFFSET ${offset}
  `)

  // Fetch mappings for these canonical brands in batch
  const canonicalIds = canonicalRows.map((r) => r.id)
  let mappingsRaw: Array<{
    brand_id: number
    mapping_id: number
    dinamik_brand_id: bigint | null
    basbug_brand_id: bigint | null
    dnmk_brand: string | null
    pt_name: string | null
    bsbg_brand: string | null
    mapping_status: string
    match_method: string | null
  }> = []

  if (canonicalIds.length > 0) {
    mappingsRaw = await db.$queryRaw`
      SELECT
        m.brand_id,
        m.id AS mapping_id,
        m.dinamik_brand_id,
        m.basbug_brand_id,
        d.brand AS dnmk_brand,
        pt.name AS pt_name,
        bs.brand AS bsbg_brand,
        m.mapping_status,
        m.match_method
      FROM catalog.brand_mappings m
      LEFT JOIN catalog.supplier_dinamik_brands d ON d.id = m.dinamik_brand_id
      LEFT JOIN catalog.supplier_basbug_brands bs ON bs.id = m.basbug_brand_id
      WHERE m.brand_id IN (${Prisma.join(canonicalIds)})
      ORDER BY m.id
    `
  }

  // Group mappings by canonical brand id
  const mappingsByBrandId = new Map<number, AdminApprovedBrandMapping[]>()
  for (const m of mappingsRaw) {
    const arr = mappingsByBrandId.get(m.brand_id) ?? []
    arr.push({
      mappingId: m.mapping_id,
      dnmkBrandsId: m.dinamik_brand_id != null ? String(m.dinamik_brand_id) : null,
      bsbgBrandsId: m.basbug_brand_id != null ? String(m.basbug_brand_id) : null,
      dnmkBrand: m.dnmk_brand,
      ptName: m.pt_name,
      bsbgBrand: m.bsbg_brand,
      mappingStatus: m.mapping_status,
      matchMethod: m.match_method
    })
    mappingsByBrandId.set(m.brand_id, arr)
  }

  const rows: AdminApprovedBrandRow[] = canonicalRows.map((r) => ({
    id: r.id,
    normalizedName: r.brand,
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
      brand: string
      logo_url: string | null
    }>
  >(Prisma.sql`
    SELECT id, brand, logo_url
    FROM catalog.brands cb
    WHERE cb.id = ${matchId}
    LIMIT 1
  `)

  const r = rows[0]
  if (!r) return null

  const mappings = await db.$queryRaw<
    Array<{
      mapping_id: number
      dinamik_brand_id: bigint | null
        basbug_brand_id: bigint | null
      dnmk_brand: string | null
      pt_name: string | null
      bsbg_brand: string | null
      mapping_status: string
      match_method: string | null
    }>
  >(Prisma.sql`
    SELECT
      m.id AS mapping_id,
      m.dinamik_brand_id,
      m.basbug_brand_id,
      d.brand AS dnmk_brand,
      pt.name AS pt_name,
      bs.brand AS bsbg_brand,
      m.mapping_status,
      m.match_method
    FROM catalog.brand_mappings m
    LEFT JOIN catalog.supplier_dinamik_brands d ON d.id = m.dinamik_brand_id
    LEFT JOIN catalog.supplier_basbug_brands bs ON bs.id = m.basbug_brand_id
    WHERE m.brand_id = ${matchId}
    ORDER BY m.id
  `)

  return {
    id: r.id,
    normalizedName: r.brand,
    logoUrl: r.logo_url,
    mappings: mappings.map((m) => ({
      mappingId: m.mapping_id,
      dnmkBrandsId: m.dinamik_brand_id != null ? String(m.dinamik_brand_id) : null,
      bsbgBrandsId: m.basbug_brand_id != null ? String(m.basbug_brand_id) : null,
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
    UPDATE catalog.brands
    SET logo_url = ${logoUrl}
    WHERE id = ${canonicalId}
  `)
  return Number(updated) > 0
}

export async function updateCanonicalBrandName(
  canonicalId: number,
  name: string
): Promise<{ success: boolean; error?: string }> {
  const trimmed = name.trim()
  if (!trimmed) {
    return { success: false, error: 'Marka adı boş olamaz.' }
  }

  try {
    const updated = await db.$executeRaw(Prisma.sql`
      UPDATE catalog.brands
      SET brand = ${trimmed}
      WHERE id = ${canonicalId}
    `)
    if (Number(updated) === 0) {
      return { success: false, error: 'Marka bulunamadı.' }
    }
    return { success: true }
  } catch (e) {
    // catalog.brands.brand @unique — çakışmayı kullanıcıya anlaşılır dön.
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('23505') || msg.toLowerCase().includes('unique')) {
      return { success: false, error: 'Bu isimde başka bir marka zaten var.' }
    }
    console.error('[updateCanonicalBrandName] Error:', e)
    return { success: false, error: 'Marka adı güncellenemedi.' }
  }
}

export async function deleteCanonicalBrand(
  canonicalId: number
): Promise<{
  success: boolean
  error?: string
  productCount?: number
  mappingCount?: number
}> {
  // Bağlı ürün veya eşleşme varsa silme — önce taşınmalı/birleştirilmeli.
  const counts = await db.$queryRaw<
    Array<{ product_count: bigint; mapping_count: bigint }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM catalog.products WHERE brand_id = ${canonicalId})::bigint AS product_count,
      (SELECT COUNT(*) FROM catalog.brand_mappings WHERE brand_id = ${canonicalId})::bigint AS mapping_count
  `)
  const productCount = Number(counts[0]?.product_count ?? 0)
  const mappingCount = Number(counts[0]?.mapping_count ?? 0)

  if (productCount > 0 || mappingCount > 0) {
    return {
      success: false,
      error: `Silinemez: ${productCount} ürün ve ${mappingCount} eşleşme bağlı. Önce taşıyın veya birleştirin.`,
      productCount,
      mappingCount
    }
  }

  const deleted = await db.$executeRaw(Prisma.sql`
    DELETE FROM catalog.brands WHERE id = ${canonicalId}
  `)
  if (Number(deleted) === 0) {
    return { success: false, error: 'Marka bulunamadı.' }
  }
  return { success: true, productCount, mappingCount }
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
      // 1. Move all mappings from source brands to target, approve them
      await tx.$executeRaw(Prisma.sql`
        UPDATE catalog.brand_mappings
        SET brand_id = ${targetId},
            mapping_status = 'APPROVED',
            match_method = COALESCE(match_method, 'MANUAL'),
            updated_at = NOW()
        WHERE brand_id IN (${Prisma.join(sourceIds)})
      `)

      // 2. Remove duplicate mappings (keep the one with lowest id for each unique combo)
      await tx.$executeRaw`
        DELETE FROM catalog.brand_mappings a
        WHERE a.id > (
          SELECT MIN(b.id)
          FROM catalog.brand_mappings b
          WHERE b.brand_id = a.brand_id
            AND b.dinamik_brand_id IS NOT DISTINCT FROM a.dinamik_brand_id
        )
      `

      // 3. If target has no logo but a source has one, copy it
      const targetLogo = await tx.$queryRaw<Array<{ logo_url: string | null }>>(
        Prisma.sql`SELECT logo_url FROM catalog.brands WHERE id = ${targetId}`
      )
      if (!targetLogo[0]?.logo_url) {
        const sourceLogos = await tx.$queryRaw<
          Array<{ logo_url: string }>
        >(
          Prisma.sql`
            SELECT logo_url
            FROM catalog.brands
            WHERE id IN (${Prisma.join(sourceIds)})
              AND logo_url IS NOT NULL
            LIMIT 1
          `
        )
        if (sourceLogos.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE catalog.brands
            SET logo_url = ${sourceLogos[0].logo_url}
            WHERE id = ${targetId}
          `)
        }
      }

      // 4. Delete source canonical brands
      await tx.$executeRaw(
        Prisma.sql`DELETE FROM catalog.brands WHERE id IN (${Prisma.join(sourceIds)})`
      )
    })

    return { success: true }
  } catch (e) {
    console.error('[mergeCanonicalBrands] Error:', e)
    return { success: false, error: 'Merge failed' }
  }
}
