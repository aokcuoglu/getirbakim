import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr } from '@/lib/sql/dproduct-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr
} from '@/lib/sql/dproduct-details'

export type AdminApprovedDpmatchFilters = {
  q?: string
  dinamikBrand?: string | null
  manufacturerId?: number | null
  matchSide?: 'all' | 'matched' | 'unmatched' | 'dinamik_only' | 'pt_only'
  page?: number
  limit?: number
  sort?: string
  sortDir?: 'asc' | 'desc'
}

export type AdminApprovedDpmatchMatchSide =
  | 'matched'
  | 'dinamik_only'
  | 'pt_only'

export type AdminApprovedDpmatchRow = {
  id: number
  dproductsId: string | null
  productId: number | null
  normalized: string | null
  mappingStatus: string
  matchMethod: string | null
  matchSide: AdminApprovedDpmatchMatchSide
  dinamik: {
    stockCode: string | null
    stockName: string | null
    brand: string | null
    barcode1: string | null
    barcode2: string | null
    barcode3: string | null
    partNo: string | null
    price: string | null
  }
  parcatedarik: {
    title: string
    model: string | null
    refNo: string | null
    manufacturerId: number | null
    manufacturerName: string
  }
}

export type AdminApprovedDpmatchListResult = {
  rows: AdminApprovedDpmatchRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: {
    total: number
    matched: number
    unmatched: number
    dinamikOnly: number
    ptOnly: number
    pending: number
  }
  filters: Required<
    Pick<
      AdminApprovedDpmatchFilters,
      'q' | 'dinamikBrand' | 'manufacturerId' | 'matchSide'
    >
  > & { page: number; limit: number }
}

const VALID_SORT_COLUMNS: Record<string, string> = {
  dproducts_id: 'm.dproducts_id',
  product_id: 'm.ptproducts_id',
  normalized: 'm.normalized',
  stock_code: 'd.stock_code'
}

function normalizeFilters(
  input: AdminApprovedDpmatchFilters = {}
): AdminApprovedDpmatchListResult['filters'] & { sort?: string; sortDir: 'asc' | 'desc' } {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const matchSide = input.matchSide ?? 'all'
  const sortDir = input.sortDir === 'desc' ? 'desc' : 'asc'

  return {
    q: (input.q ?? '').trim(),
    dinamikBrand: input.dinamikBrand?.trim() || null,
    manufacturerId:
      input.manufacturerId != null && input.manufacturerId > 0
        ? input.manufacturerId
        : null,
    matchSide:
      matchSide === 'matched' ||
      matchSide === 'unmatched' ||
      matchSide === 'dinamik_only' ||
      matchSide === 'pt_only'
        ? matchSide
        : 'all',
    page,
    limit,
    sort: input.sort,
    sortDir
  }
}

function resolveMatchSide(
  dproductsId: bigint | null,
  ptproductsId: number | null
): AdminApprovedDpmatchMatchSide {
  if (dproductsId != null && ptproductsId != null) return 'matched'
  if (dproductsId != null) return 'dinamik_only'
  return 'pt_only'
}

function buildWhereClause(
  filters: ReturnType<typeof normalizeFilters>
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`m.mapping_status IN ('APPROVED', 'PENDING')`,
    Prisma.sql`(d.id IS NULL OR d.is_passive IS DISTINCT FROM TRUE)`
  ]

  if (filters.q) {
    const p = `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`
    clauses.push(
      Prisma.sql`(COALESCE(d.stock_code,'') ILIKE ${p} OR COALESCE(d.stock_name,'') ILIKE ${p} OR COALESCE(${dproductBrandNameExpr},'') ILIKE ${p} OR COALESCE(p.title,'') ILIKE ${p} OR COALESCE(p.model,'') ILIKE ${p} OR COALESCE(mfr.name,'') ILIKE ${p})`
    )
  }
  if (filters.dinamikBrand) {
    clauses.push(
      Prisma.sql`BTRIM(LOWER(COALESCE(${dproductBrandNameExpr}, ''))) = BTRIM(LOWER(${filters.dinamikBrand}))`
    )
  }
  if (filters.manufacturerId) {
    clauses.push(Prisma.sql`p.ptbrands_id = ${filters.manufacturerId}`)
  }
  if (filters.matchSide === 'matched') {
    clauses.push(
      Prisma.sql`m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NOT NULL`
    )
  } else if (filters.matchSide === 'unmatched') {
    clauses.push(
      Prisma.sql`(
        (m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NULL)
        OR (m.dproducts_id IS NULL AND m.ptproducts_id IS NOT NULL)
      )`
    )
  } else if (filters.matchSide === 'dinamik_only') {
    clauses.push(
      Prisma.sql`m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NULL`
    )
  } else if (filters.matchSide === 'pt_only') {
    clauses.push(
      Prisma.sql`m.dproducts_id IS NULL AND m.ptproducts_id IS NOT NULL`
    )
  }

  return Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`
}

function mapRow(r: {
  id: number
  dproducts_id: bigint | null
  ptproducts_id: number | null
  normalized: string | null
  mapping_status: string
  match_method: string | null
  stock_code: string | null
  stock_name: string | null
  brand: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  part_no: string | null
  price: string | null
  title: string | null
  model: string | null
  ref_no: string | null
  ptbrands_id: number | null
  manufacturer_name: string | null
}): AdminApprovedDpmatchRow {
  return {
    id: r.id,
    dproductsId: r.dproducts_id?.toString() ?? null,
    productId: r.ptproducts_id,
    normalized: r.normalized,
    mappingStatus: r.mapping_status,
    matchMethod: r.match_method,
    matchSide: resolveMatchSide(r.dproducts_id, r.ptproducts_id),
    dinamik: {
      stockCode: r.stock_code,
      stockName: r.stock_name,
      brand: r.brand,
      barcode1: r.barcode_1,
      barcode2: r.barcode_2,
      barcode3: r.barcode_3,
      partNo: r.part_no,
      price: r.price ? String(r.price) : null
    },
    parcatedarik: {
      title: r.title ?? '',
      model: r.model,
      refNo: r.ref_no,
      manufacturerId: r.ptbrands_id,
      manufacturerName: r.manufacturer_name ?? ''
    }
  }
}

export async function listApprovedDpmatchForAdmin(
  input: AdminApprovedDpmatchFilters = {}
): Promise<AdminApprovedDpmatchListResult> {
  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit
  const whereClause = buildWhereClause(filters)
  const orderColumn =
    filters.sort && VALID_SORT_COLUMNS[filters.sort]
      ? VALID_SORT_COLUMNS[filters.sort]
      : 'm.id'
  const orderBy = Prisma.sql`${Prisma.raw(orderColumn)} ${Prisma.raw(filters.sortDir === 'desc' ? 'DESC' : 'ASC')}`

  const fromJoin = Prisma.sql`
    FROM v0.dpmatch m
    LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
    LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
    ${dproductDetailsJoin}
    LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
    LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
    ${whereClause}
  `

  const [countRows, summaryRows, rows] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count ${fromJoin}`
    ),
    db.$queryRaw<
      Array<{
        total: bigint
        matched: bigint
        unmatched: bigint
        dinamik_only: bigint
        pt_only: bigint
        pending: bigint
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NOT NULL
        )::bigint AS matched,
        COUNT(*) FILTER (
          WHERE (m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NULL)
            OR (m.dproducts_id IS NULL AND m.ptproducts_id IS NOT NULL)
        )::bigint AS unmatched,
        COUNT(*) FILTER (
          WHERE m.dproducts_id IS NOT NULL AND m.ptproducts_id IS NULL
        )::bigint AS dinamik_only,
        COUNT(*) FILTER (
          WHERE m.dproducts_id IS NULL AND m.ptproducts_id IS NOT NULL
        )::bigint AS pt_only,
        COUNT(*) FILTER (
          WHERE m.mapping_status = 'PENDING'
        )::bigint AS pending
      ${fromJoin}
    `),
    db.$queryRaw<
      Array<{
        id: number
        dproducts_id: bigint | null
        ptproducts_id: number | null
        normalized: string | null
        mapping_status: string
        match_method: string | null
        stock_code: string | null
        stock_name: string | null
        brand: string | null
        barcode_1: string | null
        barcode_2: string | null
        barcode_3: string | null
        part_no: string | null
        price: string | null
        title: string | null
        model: string | null
        ref_no: string | null
        ptbrands_id: number | null
        manufacturer_name: string | null
      }>
    >(Prisma.sql`
      SELECT
        m.id,
        m.dproducts_id,
        m.ptproducts_id,
        m.normalized,
        m.mapping_status,
        m.match_method,
        d.stock_code,
        d.stock_name,
        ${dproductBrandNameExpr} AS brand,
        d.barcode_1,
        d.barcode_2,
        d.barcode_3,
        d.part_no,
        ${dproductDetailsPriceExpr}::text AS price,
        p.title,
        p.model,
        p.ref_no,
        p.ptbrands_id,
        mfr.name AS manufacturer_name
      ${fromJoin}
      ORDER BY ${orderBy}
      LIMIT ${filters.limit} OFFSET ${offset}
    `)
  ])

  const total = Number(countRows[0]?.count ?? 0)
  const summary = summaryRows[0]

  return {
    rows: rows.map(mapRow),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      pages: Math.max(1, Math.ceil(total / filters.limit))
    },
    summary: {
      total: Number(summary?.total ?? 0),
      matched: Number(summary?.matched ?? 0),
      unmatched: Number(summary?.unmatched ?? 0),
      dinamikOnly: Number(summary?.dinamik_only ?? 0),
      ptOnly: Number(summary?.pt_only ?? 0),
      pending: Number(summary?.pending ?? 0)
    },
    filters: {
      q: filters.q,
      dinamikBrand: filters.dinamikBrand,
      manufacturerId: filters.manufacturerId,
      matchSide: filters.matchSide,
      page: filters.page,
      limit: filters.limit
    }
  }
}
