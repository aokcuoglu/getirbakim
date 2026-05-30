import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr } from '@/lib/sql/dnprd-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr,
  dproductDetailsStockExpr
} from '@/lib/sql/dnprd-details'

export type AdminDpmatchStockFilter =
  | 'all'
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'zero_price'

export type AdminDpmatchFilters = {
  q?: string
  dinamikBrand?: string | null
  manufacturerId?: number | null
  matchSide?: 'all' | 'matched' | 'unmatched' | 'dinamik_only' | 'pt_only'
  mappingStatus?: 'all' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'IGNORED'
  stockStatus?: AdminDpmatchStockFilter
  page?: number
  limit?: number
  sort?: string
  sortDir?: 'asc' | 'desc'
}

export type AdminDpmatchMatchSide = 'matched' | 'dinamik_only' | 'pt_only'

export type AdminDpmatchRow = {
  id: number
  dnprdId: string | null
  productId: number | null
  normalized_name: string | null
  mappingStatus: string
  matchMethod: string | null
  matchSide: AdminDpmatchMatchSide
  dinamik: {
    stockCode: string | null
    stockName: string | null
    brand: string | null
    barcode1: string | null
    barcode2: string | null
    barcode3: string | null
    partNo: string | null
    price: string | null
    stockQty: number | null
    isPassive: boolean
  }
  parcatedarik: {
    title: string
    model: string | null
    refNo: string | null
    imageUrl: string | null
    manufacturerId: number | null
    manufacturerName: string
    price: string | null
    priceActual: string | null
  }
}

export type AdminDpmatchListResult = {
  rows: AdminDpmatchRow[]
  pagination: { page: number; limit: number; total: number; pages: number }
  summary: {
    total: number
    matched: number
    unmatched: number
    dinamikOnly: number
    ptOnly: number
    approved: number
    pending: number
    rejected: number
    ignored: number
    lowStock: number
    zeroPrice: number
  }
  filters: Required<
    Pick<
      AdminDpmatchFilters,
      | 'q'
      | 'dinamikBrand'
      | 'manufacturerId'
      | 'matchSide'
      | 'mappingStatus'
      | 'stockStatus'
    >
  > & { page: number; limit: number }
}

/** @deprecated Use AdminDpmatchRow */
export type AdminApprovedDpmatchRow = AdminDpmatchRow

/** @deprecated Use AdminDpmatchListResult */
export type AdminApprovedDpmatchListResult = AdminDpmatchListResult

/** @deprecated Use AdminDpmatchFilters */
export type AdminApprovedDpmatchFilters = AdminDpmatchFilters

const VALID_SORT_COLUMNS: Record<string, string> = {
  dnmk_products_id: 'm.dnmk_products_id',
  product_id: 'm.ptdrk_products_id',
  normalized_name: 'm.normalized_name',
  stock_code: 'd.stock_code',
  mapping_status: 'm.mapping_status'
}

function normalizeFilters(
  input: AdminDpmatchFilters = {}
): AdminDpmatchListResult['filters'] & { sort?: string; sortDir: 'asc' | 'desc' } {
  const page = Math.max(1, input.page ?? 1)
  const limit = Math.min(Math.max(1, input.limit ?? 50), 200)
  const matchSide = input.matchSide ?? 'all'
  const mappingStatus = input.mappingStatus ?? 'all'
  const stockStatus = input.stockStatus ?? 'all'
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
    mappingStatus:
      mappingStatus === 'APPROVED' ||
      mappingStatus === 'PENDING' ||
      mappingStatus === 'REJECTED' ||
      mappingStatus === 'IGNORED'
        ? mappingStatus
        : 'all',
    stockStatus:
      stockStatus === 'in_stock' ||
      stockStatus === 'low_stock' ||
      stockStatus === 'out_of_stock' ||
      stockStatus === 'zero_price'
        ? stockStatus
        : 'all',
    page,
    limit,
    sort: input.sort,
    sortDir
  }
}

function resolveMatchSide(
  dnprdId: bigint | null,
  ptprdId: number | null
): AdminDpmatchMatchSide {
  if (dnprdId != null && ptprdId != null) return 'matched'
  if (dnprdId != null) return 'dinamik_only'
  return 'pt_only'
}

function buildWhereClause(
  filters: ReturnType<typeof normalizeFilters>
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`(d.id IS NULL OR d.is_passive IS DISTINCT FROM TRUE)`
  ]

  if (filters.mappingStatus !== 'all') {
    clauses.push(Prisma.sql`m.mapping_status = ${filters.mappingStatus}`)
  }

  if (filters.q) {
    const p = `%${filters.q.replace(/[%_\\]/g, '\\$&')}%`
    clauses.push(
      Prisma.sql`(COALESCE(d.stock_code,'') ILIKE ${p} OR COALESCE(d.stock_name,'') ILIKE ${p} OR COALESCE(${dproductBrandNameExpr},'') ILIKE ${p} OR COALESCE(p.title,'') ILIKE ${p} OR COALESCE(p.part_no,'') ILIKE ${p} OR COALESCE(mfr.name,'') ILIKE ${p})`
    )
  }
  if (filters.dinamikBrand) {
    clauses.push(
      Prisma.sql`BTRIM(LOWER(COALESCE(${dproductBrandNameExpr}, ''))) = BTRIM(LOWER(${filters.dinamikBrand}))`
    )
  }
  if (filters.manufacturerId) {
    clauses.push(Prisma.sql`p.ptdrk_brands_id = ${filters.manufacturerId}`)
  }
  if (filters.matchSide === 'matched') {
    clauses.push(
      Prisma.sql`m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NOT NULL`
    )
  } else if (filters.matchSide === 'unmatched') {
    clauses.push(
      Prisma.sql`(
        (m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NULL)
        OR (m.dnmk_products_id IS NULL AND m.ptdrk_products_id IS NOT NULL)
      )`
    )
  } else if (filters.matchSide === 'dinamik_only') {
    clauses.push(
      Prisma.sql`m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NULL`
    )
  } else if (filters.matchSide === 'pt_only') {
    clauses.push(
      Prisma.sql`m.dnmk_products_id IS NULL AND m.ptdrk_products_id IS NOT NULL`
    )
  }
  if (filters.stockStatus === 'in_stock') {
    clauses.push(Prisma.sql`COALESCE(${dproductDetailsStockExpr}, 0) > 3`)
  } else if (filters.stockStatus === 'low_stock') {
    clauses.push(
      Prisma.sql`COALESCE(${dproductDetailsStockExpr}, 0) > 0 AND COALESCE(${dproductDetailsStockExpr}, 0) <= 3`
    )
  } else if (filters.stockStatus === 'out_of_stock') {
    clauses.push(Prisma.sql`COALESCE(${dproductDetailsStockExpr}, 0) <= 0`)
  } else if (filters.stockStatus === 'zero_price') {
    clauses.push(
      Prisma.sql`COALESCE(${dproductDetailsPriceExpr}, 0) <= 0 AND COALESCE(p.price_list, 0) <= 0`
    )
  }

  return Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`
}

function mapRow(r: {
  id: number
  dnmk_products_id: bigint | null
  ptdrk_products_id: number | null
  normalized_name: string | null
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
  stock_qty: number | null
  is_passive: boolean
  title: string | null
  model: string | null
  ref_no: string | null
  image_url: string | null
  ptdrk_brands_id: number | null
  manufacturer_name: string | null
  pt_price: string | null
  pt_price_actual: string | null
}): AdminDpmatchRow {
  return {
    id: r.id,
    dnprdId: r.dnmk_products_id?.toString() ?? null,
    productId: r.ptdrk_products_id,
    normalized_name: r.normalized_name,
    mappingStatus: r.mapping_status,
    matchMethod: r.match_method,
    matchSide: resolveMatchSide(r.dnmk_products_id, r.ptdrk_products_id),
    dinamik: {
      stockCode: r.stock_code,
      stockName: r.stock_name,
      brand: r.brand,
      barcode1: r.barcode_1,
      barcode2: r.barcode_2,
      barcode3: r.barcode_3,
      partNo: r.part_no,
      price: r.price ? String(r.price) : null,
      stockQty: r.stock_qty,
      isPassive: r.is_passive ?? false
    },
    parcatedarik: {
      title: r.title ?? '',
      model: r.model,
      refNo: r.ref_no,
      imageUrl: r.image_url,
      manufacturerId: r.ptdrk_brands_id,
      manufacturerName: r.manufacturer_name ?? '',
      price: r.pt_price ?? null,
      priceActual: r.pt_price_actual
    }
  }
}

export async function listDpmatchForAdmin(
  input: AdminDpmatchFilters = {}
): Promise<AdminDpmatchListResult> {
  const filters = normalizeFilters(input)
  const offset = (filters.page - 1) * filters.limit
  const whereClause = buildWhereClause(filters)
  const orderColumn =
    filters.sort && VALID_SORT_COLUMNS[filters.sort]
      ? VALID_SORT_COLUMNS[filters.sort]
      : 'm.id'
  const orderBy = Prisma.sql`${Prisma.raw(orderColumn)} ${Prisma.raw(filters.sortDir === 'desc' ? 'DESC' : 'ASC')}`

  const fromJoin = Prisma.sql`
    FROM v0.product_list m
    LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
    LEFT JOIN v0.dnmk_brands db ON db.id = d.dnmk_brands_id
    ${dproductDetailsJoin}
    LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
    LEFT JOIN v0.ptdrk_brands mfr ON mfr.id = p.ptdrk_brands_id
    ${whereClause}
  `

  // Run in parallel: summary + rows queries use the same base join.
  const [summaryRows, rows] = await Promise.all([
    db.$queryRaw<
      Array<{
        total: bigint
        matched: bigint
        unmatched: bigint
        dinamik_only: bigint
        pt_only: bigint
        approved: bigint
        pending: bigint
        rejected: bigint
        ignored: bigint
        low_stock: bigint
        zero_price: bigint
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (
          WHERE m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NOT NULL
        )::bigint AS matched,
        COUNT(*) FILTER (
          WHERE (m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NULL)
            OR (m.dnmk_products_id IS NULL AND m.ptdrk_products_id IS NOT NULL)
        )::bigint AS unmatched,
        COUNT(*) FILTER (
          WHERE m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NULL
        )::bigint AS dinamik_only,
        COUNT(*) FILTER (
          WHERE m.dnmk_products_id IS NULL AND m.ptdrk_products_id IS NOT NULL
        )::bigint AS pt_only,
        COUNT(*) FILTER (
          WHERE m.mapping_status = 'APPROVED'
        )::bigint AS approved,
        COUNT(*) FILTER (
          WHERE m.mapping_status = 'PENDING'
        )::bigint AS pending,
        COUNT(*) FILTER (
          WHERE m.mapping_status = 'REJECTED'
        )::bigint AS rejected,
        COUNT(*) FILTER (
          WHERE m.mapping_status = 'IGNORED'
        )::bigint AS ignored,
        COUNT(*) FILTER (
          WHERE COALESCE(${dproductDetailsStockExpr}, 0) > 0
            AND COALESCE(${dproductDetailsStockExpr}, 0) <= 3
        )::bigint AS low_stock,
        COUNT(*) FILTER (
          WHERE COALESCE(${dproductDetailsPriceExpr}, 0) <= 0
            AND COALESCE(p.price_list, 0) <= 0
        )::bigint AS zero_price
      ${fromJoin}
    `),

    db.$queryRaw<
      Array<{
        id: number
        dnmk_products_id: bigint | null
        ptdrk_products_id: number | null
        normalized_name: string | null
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
        stock_qty: number | null
        is_passive: boolean
        title: string | null
        model: string | null
        ref_no: string | null
        image_url: string | null
        ptdrk_brands_id: number | null
        manufacturer_name: string | null
        pt_price: string | null
        pt_price_actual: string | null
      }>
    >(Prisma.sql`
      SELECT
        m.id,
        m.dnmk_products_id,
        m.ptdrk_products_id,
        m.normalized_name,
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
        ${dproductDetailsStockExpr} AS stock_qty,
        COALESCE(d.is_passive, false) AS is_passive,
        p.title,
        p.part_no AS model,
        p.ref_no,
        COALESCE(d.image_url, o.raw->>'resimUrl') AS image_url,
        p.ptdrk_brands_id,
        mfr.name AS manufacturer_name,
        p.price_list::text AS pt_price,
        p.price_actual::text AS pt_price_actual
      ${fromJoin}
      ORDER BY ${orderBy}
      LIMIT ${filters.limit} OFFSET ${offset}
    `)
  ])

  const summary = summaryRows[0]
  const total = Number(summary?.total ?? 0)

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
      approved: Number(summary?.approved ?? 0),
      pending: Number(summary?.pending ?? 0),
      rejected: Number(summary?.rejected ?? 0),
      ignored: Number(summary?.ignored ?? 0),
      lowStock: Number(summary?.low_stock ?? 0),
      zeroPrice: Number(summary?.zero_price ?? 0)
    },
    filters: {
      q: filters.q,
      dinamikBrand: filters.dinamikBrand,
      manufacturerId: filters.manufacturerId,
      matchSide: filters.matchSide,
      mappingStatus: filters.mappingStatus,
      stockStatus: filters.stockStatus,
      page: filters.page,
      limit: filters.limit
    }
  }
}

/** @deprecated Use listDpmatchForAdmin */
export const listApprovedDpmatchForAdmin = listDpmatchForAdmin
