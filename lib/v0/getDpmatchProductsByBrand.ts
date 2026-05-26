import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { unstable_cache } from 'next/cache'
import { dproductBrandNameExpr } from '@/lib/sql/dproduct-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr,
  dproductDetailsStockExpr
} from '@/lib/sql/dproduct-details'
import { dbrandsMatchLogoExpr } from '@/lib/v0/dbrandsMatchLogoSql'
import type {
  BrandPageFilters,
  BrandPageSort,
  BrandPageStockStatus
} from '@/lib/v0/brandPageFilters'
import type { V0DpmatchProductRow } from '@/lib/v0/types'

export const BRAND_PRODUCTS_PAGE_SIZE = 24

export type BrandProductFilter = {
  dbrandsIds: string[]
  ptbrandsId: number | null
}

type DpmatchQueryRow = {
  id: number
  dproducts_id: bigint | null
  ptproducts_id: number | null
  mapping_status: string
  match_method: string | null
  normalized: string | null
  stock_code: string | null
  stock_name: string | null
  brand: string | null
  part_no: string | null
  barcode_1: string | null
  barcode_2: string | null
  barcode_3: string | null
  dinamik_price: string | null
  dinamik_stock_qty: number | null
  title: string | null
  model: string | null
  ref_no: string | null
  pt_price: string | null
  image_url: string | null
  url: string | null
  manufacturer_name: string | null
  brand_logo_url: string | null
}

function mapRow(row: DpmatchQueryRow): V0DpmatchProductRow {
  return {
    matchId: row.id,
    dproductsId: row.dproducts_id?.toString() ?? null,
    ptproductsId: row.ptproducts_id,
    mappingStatus: row.mapping_status,
    matchMethod: row.match_method,
    normalized: row.normalized,
    dinamikStockCode: row.stock_code,
    dinamikStockName: row.stock_name,
    dinamikBrand: row.brand,
    dinamikPartNo: row.part_no,
    dinamikBarcode1: row.barcode_1,
    dinamikBarcode2: row.barcode_2,
    dinamikBarcode3: row.barcode_3,
    dinamikPrice: row.dinamik_price,
    dinamikStockQty: row.dinamik_stock_qty,
    ptTitle: row.title,
    ptModel: row.model,
    ptRefNo: row.ref_no,
    ptPrice: row.pt_price,
    ptImageUrl: row.image_url,
    ptUrl: row.url,
    ptManufacturerName: row.manufacturer_name,
    brandLogoUrl: row.brand_logo_url
  }
}

function buildBrandFilterKey(filter: BrandProductFilter): string {
  const dbrandsKey =
    filter.dbrandsIds.length > 0 ? filter.dbrandsIds.slice().sort().join(',') : 'none'
  return `${dbrandsKey}:${filter.ptbrandsId ?? 'none'}`
}

function buildFilterCacheKey(
  filter: BrandProductFilter,
  pageFilters: BrandPageFilters
): string {
  return [
    buildBrandFilterKey(filter),
    String(pageFilters.page),
    String(pageFilters.limit),
    pageFilters.sort,
    pageFilters.stock.slice().sort().join(','),
    pageFilters.minPrice ?? 'none',
    pageFilters.maxPrice ?? 'none'
  ].join(':')
}

function buildStockFilterSql(stockStatuses: BrandPageStockStatus[]): Prisma.Sql {
  if (stockStatuses.length !== 1) {
    return Prisma.empty
  }

  if (stockStatuses[0] === 'in-stock') {
    return Prisma.sql`AND COALESCE(dinamik_stock_qty, 0) > 0`
  }

  return Prisma.sql`AND COALESCE(dinamik_stock_qty, 0) <= 0`
}

function buildPriceFilterSql(
  minPrice?: number,
  maxPrice?: number
): Prisma.Sql {
  const clauses: Prisma.Sql[] = []

  if (minPrice != null) {
    clauses.push(Prisma.sql`COALESCE(pt_price::numeric, dinamik_price::numeric) >= ${new Prisma.Decimal(minPrice)}`)
  }

  if (maxPrice != null) {
    clauses.push(Prisma.sql`COALESCE(pt_price::numeric, dinamik_price::numeric) <= ${new Prisma.Decimal(maxPrice)}`)
  }

  if (clauses.length === 0) {
    return Prisma.empty
  }

  return Prisma.sql`AND ${Prisma.join(clauses, ' AND ')}`
}

function buildOrderBySql(sort: BrandPageSort): Prisma.Sql {
  switch (sort) {
    case 'price-asc':
      return Prisma.sql`ORDER BY COALESCE(pt_price::numeric, dinamik_price::numeric) ASC NULLS LAST, id DESC`
    case 'price-desc':
      return Prisma.sql`ORDER BY COALESCE(pt_price::numeric, dinamik_price::numeric) DESC NULLS LAST, id DESC`
    case 'name':
      return Prisma.sql`ORDER BY COALESCE(NULLIF(TRIM(title), ''), NULLIF(TRIM(stock_name), ''), NULLIF(TRIM(stock_code), ''), NULLIF(TRIM(model), '')) ASC NULLS LAST, id DESC`
    case 'popularity':
    default:
      return Prisma.sql`ORDER BY id DESC`
  }
}

const selectColumns = Prisma.sql`
  m.id,
  m.dproducts_id,
  m.ptproducts_id,
  m.mapping_status,
  m.match_method,
  m.normalized,
  d.stock_code,
  d.stock_name,
  ${dproductBrandNameExpr} AS brand,
  d.part_no,
  d.barcode_1,
  d.barcode_2,
  d.barcode_3,
  ${dproductDetailsPriceExpr}::text AS dinamik_price,
  ${dproductDetailsStockExpr} AS dinamik_stock_qty,
  p.title,
  p.model,
  p.ref_no,
  p.price::text AS pt_price,
  p.image_url,
  p.url,
  mfr.name AS manufacturer_name,
  ${dbrandsMatchLogoExpr} AS brand_logo_url
`

function buildBrandProductsUnionSql(filter: BrandProductFilter): Prisma.Sql {
  const dbrandsIds = filter.dbrandsIds.map((id) => BigInt(id))
  const ptbrandsId = filter.ptbrandsId

  if (dbrandsIds.length === 0 && !ptbrandsId) {
    return Prisma.sql`SELECT ${selectColumns} FROM v0.dpmatch m WHERE FALSE`
  }

  if (dbrandsIds.length > 0 && ptbrandsId) {
    return Prisma.sql`
      SELECT ${selectColumns}
      FROM v0.dproducts d
      INNER JOIN v0.dpmatch m
        ON m.dproducts_id = d.id
        AND m.mapping_status = 'APPROVED'
      LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
      ${dproductDetailsJoin}
      LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
      LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
      WHERE d.dbrands_id IN (${Prisma.join(dbrandsIds)})
        AND d.is_passive IS DISTINCT FROM TRUE
      UNION
      SELECT ${selectColumns}
      FROM v0.ptproducts p
      INNER JOIN v0.dpmatch m
        ON m.ptproducts_id = p.id
        AND m.mapping_status = 'APPROVED'
      LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
      LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
      ${dproductDetailsJoin}
      LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
      WHERE p.ptbrands_id = ${ptbrandsId}
        AND (d.id IS NULL OR d.is_passive IS DISTINCT FROM TRUE)
    `
  }

  if (dbrandsIds.length > 0) {
    return Prisma.sql`
      SELECT ${selectColumns}
      FROM v0.dproducts d
      INNER JOIN v0.dpmatch m
        ON m.dproducts_id = d.id
        AND m.mapping_status = 'APPROVED'
      LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
      ${dproductDetailsJoin}
      LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
      LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
      WHERE d.dbrands_id IN (${Prisma.join(dbrandsIds)})
        AND d.is_passive IS DISTINCT FROM TRUE
    `
  }

  return Prisma.sql`
    SELECT ${selectColumns}
    FROM v0.ptproducts p
    INNER JOIN v0.dpmatch m
      ON m.ptproducts_id = p.id
      AND m.mapping_status = 'APPROVED'
    LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
    LEFT JOIN v0.dbrands db ON db.id = d.dbrands_id
    ${dproductDetailsJoin}
    LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
    WHERE p.ptbrands_id = ${ptbrandsId}
      AND (d.id IS NULL OR d.is_passive IS DISTINCT FROM TRUE)
  `
}

async function fetchFilteredBrandProducts(
  filter: BrandProductFilter,
  pageFilters: BrandPageFilters,
  limit: number,
  offset: number
): Promise<DpmatchQueryRow[]> {
  const unionSql = buildBrandProductsUnionSql(filter)
  const stockFilterSql = buildStockFilterSql(pageFilters.stock)
  const priceFilterSql = buildPriceFilterSql(pageFilters.minPrice, pageFilters.maxPrice)
  const orderBySql = buildOrderBySql(pageFilters.sort)

  return db.$queryRaw<DpmatchQueryRow[]>(Prisma.sql`
    SELECT * FROM (
      ${unionSql}
    ) brand_products
    WHERE 1=1
      ${stockFilterSql}
      ${priceFilterSql}
    ${orderBySql}
    LIMIT ${limit}
    OFFSET ${offset}
  `)
}

async function fetchBrandProductsTotalCount(
  filter: BrandProductFilter,
  pageFilters: BrandPageFilters
): Promise<number> {
  const unionSql = buildBrandProductsUnionSql(filter)
  const stockFilterSql = buildStockFilterSql(pageFilters.stock)
  const priceFilterSql = buildPriceFilterSql(pageFilters.minPrice, pageFilters.maxPrice)

  const rows = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM (
      ${unionSql}
    ) brand_products
    WHERE 1=1
      ${stockFilterSql}
      ${priceFilterSql}
  `)

  return Number(rows[0]?.count ?? 0)
}

async function fetchBrandStockFacetDistribution(
  filter: BrandProductFilter,
  pageFilters: BrandPageFilters
): Promise<{ 'in-stock': number; 'on-order': number }> {
  const unionSql = buildBrandProductsUnionSql(filter)
  const priceFilterSql = buildPriceFilterSql(pageFilters.minPrice, pageFilters.maxPrice)

  const rows = await db.$queryRaw<
    Array<{ in_stock: bigint; on_order: bigint }>
  >(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(dinamik_stock_qty, 0) > 0)::bigint AS in_stock,
      COUNT(*) FILTER (WHERE COALESCE(dinamik_stock_qty, 0) <= 0)::bigint AS on_order
    FROM (
      ${unionSql}
    ) brand_products
    WHERE 1=1
      ${priceFilterSql}
  `)

  return {
    'in-stock': Number(rows[0]?.in_stock ?? 0),
    'on-order': Number(rows[0]?.on_order ?? 0)
  }
}

export type BrandProductsPage = {
  products: V0DpmatchProductRow[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  hasNextPage: boolean
  stockFacetDistribution: { 'in-stock': number; 'on-order': number }
}

async function fetchBrandProductsPageUncached(
  filter: BrandProductFilter,
  pageFilters: BrandPageFilters
): Promise<BrandProductsPage> {
  const safePage = Math.max(1, pageFilters.page)
  const pageSize = pageFilters.limit
  const offset = (safePage - 1) * pageSize

  const [rows, totalCount, stockFacetDistribution] = await Promise.all([
    fetchFilteredBrandProducts(filter, pageFilters, pageSize + 1, offset),
    fetchBrandProductsTotalCount(filter, pageFilters),
    fetchBrandStockFacetDistribution(filter, pageFilters)
  ])

  const hasNextPage = rows.length > pageSize
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return {
    products: (hasNextPage ? rows.slice(0, pageSize) : rows).map(mapRow),
    page: safePage,
    pageSize,
    totalCount,
    totalPages,
    hasNextPage,
    stockFacetDistribution
  }
}

export async function getDpmatchProductsByBrandPage(
  filter: BrandProductFilter,
  pageFilters: BrandPageFilters
): Promise<BrandProductsPage> {
  const cacheKey = buildFilterCacheKey(filter, pageFilters)

  return unstable_cache(
    () => fetchBrandProductsPageUncached(filter, pageFilters),
    ['v0-brand-dpmatch-products', cacheKey],
    { revalidate: 300 }
  )()
}
