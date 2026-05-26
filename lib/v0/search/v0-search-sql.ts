import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr, dproductDbrandLeftJoin } from '@/lib/sql/dproduct-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr,
  dproductDetailsStockExpr
} from '@/lib/sql/dproduct-details'
import { dbrandsMatchBrandNameExpr } from '@/lib/v0/dbrandsMatchBrandNameSql'
import { dbrandsMatchLogoExpr } from '@/lib/v0/dbrandsMatchLogoSql'
import { compactCode, normalizeCode } from '@/lib/search/code-normalization'
import type { V0DpmatchProductRow } from '@/lib/v0/types'
import type { V0BrandMatchRow } from '@/lib/v0/types'
import { toBrandSlug } from '@/lib/v0/brandSlug'
import { mapDpmatchIndexRowToProductRow } from '@/lib/v0/search/v0-search-document'

export type V0SqlSearchResult = {
  products: V0DpmatchProductRow[]
  brands: V0BrandMatchRow[]
  totalProducts: number
  durationMs: number
}

type DpmatchSearchRow = Parameters<typeof mapDpmatchIndexRowToProductRow>[0] & {
  dproducts_id: bigint
  ptproducts_id: number | null
}

type BrandSearchRow = {
  id: number
  dbrands_ids: bigint[] | null
  ptbrands_id: number | null
  brand_name: string
  pt_url_key: string | null
  logo_url: string | null
}

function escapeIlikePattern(query: string): string {
  return `%${query.replace(/[%_\\]/g, '\\$&')}%`
}

function isCodeLikeV0Query(query: string): boolean {
  const compact = compactCode(query)
  return compact.length >= 3 && compact.length <= 32 && /\d/.test(compact)
}

const DPMATCH_PRODUCT_SELECT = Prisma.sql`
  SELECT
    m.id,
    m.dproducts_id,
    m.ptproducts_id,
    d.stock_code,
    d.stock_name,
    ${dproductBrandNameExpr} AS brand,
    d.part_no,
    d.barcode_1,
    d.barcode_2,
    d.barcode_3,
    p.title,
    p.model,
    p.ref_no,
    m.normalized,
    ${dproductDetailsPriceExpr}::text AS dinamik_price,
    ${dproductDetailsStockExpr} AS dinamik_stock_qty,
    p.price::text AS pt_price,
    p.image_url,
    mfr.name AS manufacturer_name,
    ${dbrandsMatchBrandNameExpr} AS matched_brand,
    o.raw AS dinamik_raw,
    ${dbrandsMatchLogoExpr} AS brand_logo_url
`

async function lookupV0ExactPartCode(options: {
  query: string
  limit: number
  offset: number
  brandNames?: string[]
}): Promise<DpmatchSearchRow[]> {
  const normalized = normalizeCode(options.query)
  if (normalized.length < 3) return []

  const normField = (field: Prisma.Sql) => Prisma.sql`
    REPLACE(REPLACE(REPLACE(REPLACE(UPPER(COALESCE(${field}::text, '')), '-', ''), '.', ''), ' ', ''), '/', '')`

  const [dproductIdRows, ptproductIdRows] = await Promise.all([
    db.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
      SELECT d.id
      FROM v0.dproducts d
      WHERE d.is_passive IS DISTINCT FROM TRUE
        AND (
          ${normField(Prisma.sql`d.part_no`)} = ${normalized}
          OR ${normField(Prisma.sql`d.stock_code`)} = ${normalized}
          OR ${normField(Prisma.sql`d.barcode_1`)} = ${normalized}
          OR ${normField(Prisma.sql`d.barcode_2`)} = ${normalized}
          OR ${normField(Prisma.sql`d.barcode_3`)} = ${normalized}
        )
      LIMIT 80
    `),
    db.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT p.id
      FROM v0.ptproducts p
      WHERE (
          ${normField(Prisma.sql`p.model`)} = ${normalized}
          OR ${normField(Prisma.sql`p.ref_no`)} = ${normalized}
        )
      LIMIT 80
    `)
  ])

  const dproductIds = dproductIdRows.map((row) => row.id)
  const ptproductIds = ptproductIdRows.map((row) => row.id)
  if (dproductIds.length === 0 && ptproductIds.length === 0) {
    return []
  }

  const matchIdFilter =
    dproductIds.length > 0 && ptproductIds.length > 0
      ? Prisma.sql`(
          m.dproducts_id IN (${Prisma.join(dproductIds)})
          OR m.ptproducts_id IN (${Prisma.join(ptproductIds)})
        )`
      : dproductIds.length > 0
        ? Prisma.sql`m.dproducts_id IN (${Prisma.join(dproductIds)})`
        : Prisma.sql`m.ptproducts_id IN (${Prisma.join(ptproductIds)})`

  const brandFilter =
    options.brandNames && options.brandNames.length > 0
      ? Prisma.sql`AND COALESCE(${dbrandsMatchBrandNameExpr}, '') IN (${Prisma.join(
          options.brandNames.map((name) => Prisma.sql`${name}`)
        )})`
      : Prisma.empty

  return db.$queryRaw<DpmatchSearchRow[]>(Prisma.sql`
    ${DPMATCH_PRODUCT_SELECT}
    ${DPMATCH_SEARCH_FROM}
      AND ${matchIdFilter}
      ${brandFilter}
    ORDER BY m.id DESC
    LIMIT ${options.limit}
    OFFSET ${options.offset}
  `)
}

function buildCodeSearchClause(query: string): Prisma.Sql {
  const trimmed = query.trim()
  const pattern = escapeIlikePattern(trimmed)
  const compact = compactCode(trimmed)
  const compactPattern =
    compact.length >= 3 ? escapeIlikePattern(compact) : pattern
  const queryHasSeparators = /[-./\\]/.test(trimmed)
  const needsCompactFieldMatch = compact.length >= 3 && !queryHasSeparators

  const compactFieldMatch = (field: Prisma.Sql) =>
    needsCompactFieldMatch
      ? Prisma.sql`REPLACE(REPLACE(REPLACE(REPLACE(LOWER(COALESCE(${field}::text, '')), '-', ''), '.', ''), ' ', ''), '/', '') ILIKE ${compactPattern}`
      : Prisma.sql`FALSE`

  const compactIlike =
    !needsCompactFieldMatch && compact.length >= 3
      ? Prisma.sql`
    OR COALESCE(d.stock_code, '') ILIKE ${compactPattern}
    OR COALESCE(d.part_no, '') ILIKE ${compactPattern}
    OR COALESCE(p.model, '') ILIKE ${compactPattern}
    OR COALESCE(p.ref_no, '') ILIKE ${compactPattern}`
      : Prisma.empty

  return Prisma.sql`(
    COALESCE(d.stock_code, '') ILIKE ${pattern}
    OR COALESCE(d.part_no, '') ILIKE ${pattern}
    OR COALESCE(p.model, '') ILIKE ${pattern}
    OR COALESCE(p.ref_no, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_1, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_2, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_3, '') ILIKE ${pattern}
    OR COALESCE(m.normalized, '') ILIKE ${pattern}
    ${compactIlike}
    OR ${compactFieldMatch(Prisma.sql`d.stock_code`)}
    OR ${compactFieldMatch(Prisma.sql`d.part_no`)}
    OR ${compactFieldMatch(Prisma.sql`p.model`)}
    OR ${compactFieldMatch(Prisma.sql`p.ref_no`)}
  )`
}

function buildProductSearchClause(query: string): Prisma.Sql {
  if (isCodeLikeV0Query(query)) {
    return buildCodeSearchClause(query)
  }

  const trimmed = query.trim()
  if (!trimmed) {
    return Prisma.sql`TRUE`
  }

  const pattern = escapeIlikePattern(trimmed)
  const compact = compactCode(trimmed)
  const compactPattern =
    compact.length >= 3 ? escapeIlikePattern(compact) : pattern
  const queryHasSeparators = /[-./\\]/.test(trimmed)
  const needsCompactFieldMatch = compact.length >= 3 && !queryHasSeparators

  const compactFieldMatch = (field: Prisma.Sql) =>
    needsCompactFieldMatch
      ? Prisma.sql`REPLACE(REPLACE(REPLACE(REPLACE(LOWER(COALESCE(${field}::text, '')), '-', ''), '.', ''), ' ', ''), '/', '') ILIKE ${compactPattern}`
      : Prisma.sql`FALSE`

  const compactIlike = needsCompactFieldMatch
    ? Prisma.empty
    : compact.length >= 3
      ? Prisma.sql`
    OR COALESCE(d.stock_code, '') ILIKE ${compactPattern}
    OR COALESCE(d.part_no, '') ILIKE ${compactPattern}
    OR COALESCE(p.model, '') ILIKE ${compactPattern}
    OR COALESCE(p.ref_no, '') ILIKE ${compactPattern}`
      : Prisma.empty

  return Prisma.sql`(
    COALESCE(${dbrandsMatchBrandNameExpr}, '') ILIKE ${pattern}
    OR COALESCE(p.title, '') ILIKE ${pattern}
    OR COALESCE(p.model, '') ILIKE ${pattern}
    OR COALESCE(d.stock_code, '') ILIKE ${pattern}
    OR COALESCE(d.stock_name, '') ILIKE ${pattern}
    OR COALESCE(d.part_no, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_1, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_2, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_3, '') ILIKE ${pattern}
    OR COALESCE(m.normalized, '') ILIKE ${pattern}
    OR COALESCE(o.raw::text, '') ILIKE ${pattern}
    OR COALESCE(p.ref_no, '') ILIKE ${pattern}
    ${compactIlike}
    OR ${compactFieldMatch(Prisma.sql`d.stock_code`)}
    OR ${compactFieldMatch(Prisma.sql`d.part_no`)}
    OR ${compactFieldMatch(Prisma.sql`p.model`)}
    OR ${compactFieldMatch(Prisma.sql`p.ref_no`)}
  )`
}

const DPMATCH_SEARCH_FROM = Prisma.sql`
  FROM v0.dpmatch m
  INNER JOIN v0.dproducts d ON d.id = m.dproducts_id
  ${dproductDbrandLeftJoin}
  LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
  LEFT JOIN v0.ptbrands mfr ON mfr.id = p.ptbrands_id
  ${dproductDetailsJoin}
  WHERE m.mapping_status = 'APPROVED'
    AND d.is_passive IS DISTINCT FROM TRUE
`

function mapBrandSearchRow(row: BrandSearchRow): V0BrandMatchRow {
  const dbrandsIds = (row.dbrands_ids ?? []).map((id) => id.toString())
  return {
    matchId: row.id,
    dbrandsId: dbrandsIds[0] ?? null,
    dbrandsIds,
    ptbrandsId: row.ptbrands_id,
    brandName: row.brand_name,
    ptUrlKey: row.pt_url_key,
    logoUrl: row.logo_url,
    slug: toBrandSlug(row.pt_url_key, row.brand_name)
  }
}

function mapDpmatchSearchRow(row: DpmatchSearchRow): V0DpmatchProductRow {
  const base = mapDpmatchIndexRowToProductRow(row)
  return {
    ...base,
    dproductsId: row.dproducts_id.toString(),
    ptproductsId: row.ptproducts_id
  }
}

export async function searchV0CatalogSql(options: {
  query: string
  page?: number
  limit?: number
  brandNames?: string[]
}): Promise<V0SqlSearchResult> {
  const start = performance.now()
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(Math.max(1, options.limit ?? 24), 60)
  const offset = (page - 1) * limit
  const trimmed = options.query.trim()

  if (trimmed && isCodeLikeV0Query(trimmed)) {
    const exactRows = await lookupV0ExactPartCode({
      query: trimmed,
      limit,
      offset,
      brandNames: options.brandNames
    })
    if (exactRows.length > 0) {
      let brands: V0BrandMatchRow[] = []
      if (page === 1) {
        const brandPattern = escapeIlikePattern(trimmed)
        const brandRows = await db.$queryRaw<BrandSearchRow[]>(Prisma.sql`
          WITH approved AS (
            SELECT
              a.id,
              a.dbrands_id,
              a.ptbrands_id,
              a.normalized,
              a.logo_url,
              d.brand AS dinamik_brand,
              m.name AS ptbrand_name,
              m.url_key AS pt_url_key
            FROM v0.dbrands_match a
            LEFT JOIN v0.dbrands d ON d.id = a.dbrands_id
            LEFT JOIN v0.ptbrands m ON m.id = a.ptbrands_id
            WHERE a.mapping_status = 'APPROVED'
              AND BTRIM(COALESCE(a.normalized, d.brand, m.name, '')) <> ''
          ),
          with_key AS (
            SELECT
              *,
              COALESCE(NULLIF(BTRIM(normalized), ''), 'id:' || id::text) AS group_key
            FROM approved
          ),
          grouped AS (
            SELECT
              MIN(id) AS id,
              ARRAY_AGG(DISTINCT dbrands_id) FILTER (WHERE dbrands_id IS NOT NULL) AS dbrands_ids,
              MIN(ptbrands_id) AS ptbrands_id,
              COALESCE(
                MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
                MAX(NULLIF(BTRIM(normalized), '')),
                MIN(dinamik_brand) FILTER (WHERE dinamik_brand IS NOT NULL)
              ) AS brand_name,
              MAX(pt_url_key) AS pt_url_key,
              MAX(logo_url) FILTER (WHERE logo_url IS NOT NULL) AS logo_url
            FROM with_key
            GROUP BY group_key
          )
          SELECT g.id, g.dbrands_ids, g.ptbrands_id, g.brand_name, g.pt_url_key, g.logo_url
          FROM grouped g
          WHERE g.brand_name ILIKE ${brandPattern}
          ORDER BY g.brand_name ASC
          LIMIT 5
        `)
        brands = brandRows.map(mapBrandSearchRow)
      }

      return {
        products: exactRows.map(mapDpmatchSearchRow),
        brands,
        totalProducts: exactRows.length,
        durationMs: Number((performance.now() - start).toFixed(2))
      }
    }
  }

  const searchClause = trimmed
    ? isCodeLikeV0Query(trimmed)
      ? buildCodeSearchClause(trimmed)
      : buildProductSearchClause(trimmed)
    : Prisma.sql`TRUE`
  const skipExactCount = limit <= 10 && Boolean(trimmed)
  const brandFilter =
    options.brandNames && options.brandNames.length > 0
      ? Prisma.sql`AND COALESCE(${dbrandsMatchBrandNameExpr}, '') IN (${Prisma.join(
          options.brandNames.map((name) => Prisma.sql`${name}`)
        )})`
      : Prisma.empty

  const [countRows, productRows] = skipExactCount
    ? [[], await db.$queryRaw<DpmatchSearchRow[]>(Prisma.sql`
      SELECT
        m.id,
        m.dproducts_id,
        m.ptproducts_id,
        d.stock_code,
        d.stock_name,
        ${dproductBrandNameExpr} AS brand,
        d.part_no,
        d.barcode_1,
        d.barcode_2,
        d.barcode_3,
        p.title,
        p.model,
        p.ref_no,
        m.normalized,
        ${dproductDetailsPriceExpr}::text AS dinamik_price,
        ${dproductDetailsStockExpr} AS dinamik_stock_qty,
        p.price::text AS pt_price,
        p.image_url,
        mfr.name AS manufacturer_name,
        ${dbrandsMatchBrandNameExpr} AS matched_brand,
        o.raw AS dinamik_raw,
        ${dbrandsMatchLogoExpr} AS brand_logo_url
      ${DPMATCH_SEARCH_FROM}
        AND ${searchClause}
        ${brandFilter}
      ORDER BY m.id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `)] as const
    : await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      ${DPMATCH_SEARCH_FROM}
        AND ${searchClause}
        ${brandFilter}
    `),
    db.$queryRaw<DpmatchSearchRow[]>(Prisma.sql`
      SELECT
        m.id,
        m.dproducts_id,
        m.ptproducts_id,
        d.stock_code,
        d.stock_name,
        ${dproductBrandNameExpr} AS brand,
        d.part_no,
        d.barcode_1,
        d.barcode_2,
        d.barcode_3,
        p.title,
        p.model,
        p.ref_no,
        m.normalized,
        ${dproductDetailsPriceExpr}::text AS dinamik_price,
        ${dproductDetailsStockExpr} AS dinamik_stock_qty,
        p.price::text AS pt_price,
        p.image_url,
        mfr.name AS manufacturer_name,
        ${dbrandsMatchBrandNameExpr} AS matched_brand,
        o.raw AS dinamik_raw,
        ${dbrandsMatchLogoExpr} AS brand_logo_url
      ${DPMATCH_SEARCH_FROM}
        AND ${searchClause}
        ${brandFilter}
      ORDER BY m.id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `)
  ])

  let brands: V0BrandMatchRow[] = []
  if (trimmed && page === 1) {
    const brandPattern = escapeIlikePattern(trimmed)
    const brandRows = await db.$queryRaw<BrandSearchRow[]>(Prisma.sql`
      WITH approved AS (
        SELECT
          a.id,
          a.dbrands_id,
          a.ptbrands_id,
          a.normalized,
          a.logo_url,
          d.brand AS dinamik_brand,
          m.name AS ptbrand_name,
          m.url_key AS pt_url_key
        FROM v0.dbrands_match a
        LEFT JOIN v0.dbrands d ON d.id = a.dbrands_id
        LEFT JOIN v0.ptbrands m ON m.id = a.ptbrands_id
        WHERE a.mapping_status = 'APPROVED'
          AND BTRIM(COALESCE(a.normalized, d.brand, m.name, '')) <> ''
      ),
      with_key AS (
        SELECT
          *,
          COALESCE(NULLIF(BTRIM(normalized), ''), 'id:' || id::text) AS group_key
        FROM approved
      ),
      grouped AS (
        SELECT
          MIN(id) AS id,
          ARRAY_AGG(DISTINCT dbrands_id) FILTER (WHERE dbrands_id IS NOT NULL) AS dbrands_ids,
          MIN(ptbrands_id) AS ptbrands_id,
          COALESCE(
            MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
            MAX(NULLIF(BTRIM(normalized), '')),
            MIN(dinamik_brand) FILTER (WHERE dinamik_brand IS NOT NULL)
          ) AS brand_name,
          MAX(pt_url_key) AS pt_url_key,
          MAX(logo_url) FILTER (WHERE logo_url IS NOT NULL) AS logo_url
        FROM with_key
        GROUP BY group_key
      )
      SELECT g.id, g.dbrands_ids, g.ptbrands_id, g.brand_name, g.pt_url_key, g.logo_url
      FROM grouped g
      WHERE g.brand_name ILIKE ${brandPattern}
      ORDER BY g.brand_name ASC
      LIMIT 5
    `)
    brands = brandRows.map(mapBrandSearchRow)
  }

  return {
    products: productRows.map(mapDpmatchSearchRow),
    brands,
    totalProducts: skipExactCount
      ? productRows.length
      : Number(countRows[0]?.count ?? 0),
    durationMs: Number((performance.now() - start).toFixed(2))
  }
}

