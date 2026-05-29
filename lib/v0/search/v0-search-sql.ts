import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { dproductBrandNameExpr, dproductDbrandLeftJoin } from '@/lib/sql/dnprd-catalog'
import {
  dproductDetailsJoin,
  dproductDetailsPriceExpr,
  dproductDetailsStockExpr
} from '@/lib/sql/dnprd-details'
import { dnbrdMatchBrandNameExpr } from '@/lib/v0/dnbrdMatchBrandNameSql'
import { dnbrdMatchLogoExpr } from '@/lib/v0/dnbrdMatchLogoSql'
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
  dnmk_products_id: bigint
  ptdrk_products_id: number | null
}

type BrandSearchRow = {
  id: number
  dbrands_ids: bigint[] | null
  ptdrk_brands_id: number | null
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
    m.dnmk_products_id,
    m.ptdrk_products_id,
    d.stock_code,
    d.stock_name,
    ${dproductBrandNameExpr} AS brand,
    d.part_no,
    d.barcode_1,
    d.barcode_2,
    d.barcode_3,
    p.title,
    p.part_no AS model,
    p.ref_no,
    m.normalized_name,
    ${dproductDetailsPriceExpr}::text AS dinamik_price,
    ${dproductDetailsStockExpr} AS dinamik_stock_qty,
    p.price_list::text AS pt_price,
    COALESCE(d.image_url, o.raw->>'resimUrl') AS image_url,
    mfr.name AS manufacturer_name,
    ${dnbrdMatchBrandNameExpr} AS matched_brand,
    o.raw AS dinamik_raw,
    ${dnbrdMatchLogoExpr} AS brand_logo_url
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
      FROM v0.dnmk_products d
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
      FROM v0.ptdrk_products p
      WHERE (
          ${normField(Prisma.sql`p.part_no`)} = ${normalized}
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
          m.dnmk_products_id IN (${Prisma.join(dproductIds)})
          OR m.ptdrk_products_id IN (${Prisma.join(ptproductIds)})
        )`
      : dproductIds.length > 0
        ? Prisma.sql`m.dnmk_products_id IN (${Prisma.join(dproductIds)})`
        : Prisma.sql`m.ptdrk_products_id IN (${Prisma.join(ptproductIds)})`

  const brandFilter =
    options.brandNames && options.brandNames.length > 0
      ? Prisma.sql`AND COALESCE(${dnbrdMatchBrandNameExpr}, '') IN (${Prisma.join(
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
  OR COALESCE(p.part_no, '') ILIKE ${compactPattern}
  OR COALESCE(p.ref_no, '') ILIKE ${compactPattern}`
      : Prisma.empty

  return Prisma.sql`(
    COALESCE(d.stock_code, '') ILIKE ${pattern}
    OR COALESCE(d.part_no, '') ILIKE ${pattern}
    OR COALESCE(p.part_no, '') ILIKE ${pattern}
    OR COALESCE(p.ref_no, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_1, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_2, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_3, '') ILIKE ${pattern}
    OR COALESCE(m.normalized_name, '') ILIKE ${pattern}
    ${compactIlike}
    OR ${compactFieldMatch(Prisma.sql`d.stock_code`)}
    OR ${compactFieldMatch(Prisma.sql`d.part_no`)}
    OR ${compactFieldMatch(Prisma.sql`p.part_no`)}
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
    OR COALESCE(p.part_no, '') ILIKE ${compactPattern}
    OR COALESCE(p.ref_no, '') ILIKE ${compactPattern}`
      : Prisma.empty

  return Prisma.sql`(
    COALESCE(${dnbrdMatchBrandNameExpr}, '') ILIKE ${pattern}
    OR COALESCE(p.title, '') ILIKE ${pattern}
    OR COALESCE(p.part_no, '') ILIKE ${pattern}
    OR COALESCE(d.stock_code, '') ILIKE ${pattern}
    OR COALESCE(d.stock_name, '') ILIKE ${pattern}
    OR COALESCE(d.part_no, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_1, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_2, '') ILIKE ${pattern}
    OR COALESCE(d.barcode_3, '') ILIKE ${pattern}
    OR COALESCE(m.normalized_name, '') ILIKE ${pattern}
    OR COALESCE(o.raw::text, '') ILIKE ${pattern}
    OR COALESCE(p.ref_no, '') ILIKE ${pattern}
    ${compactIlike}
    OR ${compactFieldMatch(Prisma.sql`d.stock_code`)}
    OR ${compactFieldMatch(Prisma.sql`d.part_no`)}
    OR ${compactFieldMatch(Prisma.sql`p.part_no`)}
    OR ${compactFieldMatch(Prisma.sql`p.ref_no`)}
  )`
}

const DPMATCH_SEARCH_FROM = Prisma.sql`
  FROM v0.dnmk_ptdrk_products m
  INNER JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
  ${dproductDbrandLeftJoin}
  LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
  LEFT JOIN v0.ptdrk_brands mfr ON mfr.id = p.ptdrk_brands_id
  ${dproductDetailsJoin}
  WHERE m.mapping_status = 'APPROVED'
    AND d.is_passive IS DISTINCT FROM TRUE
`

function mapBrandSearchRow(row: BrandSearchRow): V0BrandMatchRow {
  const dnbrdIds = (row.dbrands_ids ?? []).map((id) => id.toString())
  return {
    matchId: row.id,
    dnbrdId: dnbrdIds[0] ?? null,
    dnbrdIds,
    ptbrdId: row.ptdrk_brands_id,
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
    dnprdId: row.dnmk_products_id.toString(),
    ptprdId: row.ptdrk_products_id
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
          m.id,
          m.dnmk_brands_id,
          m.ptdrk_brands_id,
          cb.normalized_brand,
          cb.logo_url,
          d.brand AS dinamik_brand,
          pt.name AS ptbrand_name,
          pt.url_key AS pt_url_key
        FROM v0.dnmk_ptdrk_brand_mappings m
        JOIN v0.dnmk_ptdrk_brands cb ON cb.id = m.dnmk_ptdrk_brands_id
        LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
        LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
        WHERE m.mapping_status = 'APPROVED'
          AND BTRIM(COALESCE(cb.normalized_brand, d.brand, pt.name, '')) <> ''
          ),
          with_key AS (
            SELECT
              *,
              COALESCE(NULLIF(BTRIM(normalized_brand), ''), 'id:' || id::text) AS group_key
            FROM approved
          ),
          grouped AS (
            SELECT
              MIN(id) AS id,
              ARRAY_AGG(DISTINCT dnmk_brands_id) FILTER (WHERE dnmk_brands_id IS NOT NULL) AS dbrands_ids,
              MIN(ptdrk_brands_id) AS ptdrk_brands_id,
              COALESCE(
                MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
                MAX(NULLIF(BTRIM(normalized_brand), '')),
                MIN(dinamik_brand) FILTER (WHERE dinamik_brand IS NOT NULL)
              ) AS brand_name,
              MAX(pt_url_key) AS pt_url_key,
              MAX(logo_url) FILTER (WHERE logo_url IS NOT NULL) AS logo_url
            FROM with_key
            GROUP BY group_key
          )
          SELECT g.id, g.dbrands_ids, g.ptdrk_brands_id, g.brand_name, g.pt_url_key, g.logo_url
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
      ? Prisma.sql`AND COALESCE(${dnbrdMatchBrandNameExpr}, '') IN (${Prisma.join(
          options.brandNames.map((name) => Prisma.sql`${name}`)
        )})`
      : Prisma.empty

  const [countRows, productRows] = skipExactCount
    ? [[], await db.$queryRaw<DpmatchSearchRow[]>(Prisma.sql`
      SELECT
        m.id,
        m.dnmk_products_id,
        m.ptdrk_products_id,
        d.stock_code,
        d.stock_name,
        ${dproductBrandNameExpr} AS brand,
        d.part_no,
        d.barcode_1,
        d.barcode_2,
        d.barcode_3,
        p.title,
        p.part_no AS model,
        p.ref_no,
        m.normalized_name,
        ${dproductDetailsPriceExpr}::text AS dinamik_price,
        ${dproductDetailsStockExpr} AS dinamik_stock_qty,
        p.price_list::text AS pt_price,
        COALESCE(d.image_url, o.raw->>'resimUrl') AS image_url,
        mfr.name AS manufacturer_name,
        ${dnbrdMatchBrandNameExpr} AS matched_brand,
        o.raw AS dinamik_raw,
        ${dnbrdMatchLogoExpr} AS brand_logo_url
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
        m.dnmk_products_id,
        m.ptdrk_products_id,
        d.stock_code,
        d.stock_name,
        ${dproductBrandNameExpr} AS brand,
        d.part_no,
        d.barcode_1,
        d.barcode_2,
        d.barcode_3,
        p.title,
        p.part_no AS model,
        p.ref_no,
        m.normalized_name,
        ${dproductDetailsPriceExpr}::text AS dinamik_price,
        ${dproductDetailsStockExpr} AS dinamik_stock_qty,
        p.price_list::text AS pt_price,
        COALESCE(d.image_url, o.raw->>'resimUrl') AS image_url,
        mfr.name AS manufacturer_name,
        ${dnbrdMatchBrandNameExpr} AS matched_brand,
        o.raw AS dinamik_raw,
        ${dnbrdMatchLogoExpr} AS brand_logo_url
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
          m.id,
          m.dnmk_brands_id,
          m.ptdrk_brands_id,
          cb.normalized_brand,
          cb.logo_url,
          d.brand AS dinamik_brand,
          pt.name AS ptbrand_name,
          pt.url_key AS pt_url_key
        FROM v0.dnmk_ptdrk_brand_mappings m
        JOIN v0.dnmk_ptdrk_brands cb ON cb.id = m.dnmk_ptdrk_brands_id
        LEFT JOIN v0.dnmk_brands d ON d.id = m.dnmk_brands_id
        LEFT JOIN v0.ptdrk_brands pt ON pt.id = m.ptdrk_brands_id
        WHERE m.mapping_status = 'APPROVED'
          AND BTRIM(COALESCE(cb.normalized_brand, d.brand, pt.name, '')) <> ''
      ),
      with_key AS (
        SELECT
          *,
          COALESCE(NULLIF(BTRIM(normalized_brand), ''), 'id:' || id::text) AS group_key
        FROM approved
      ),
      grouped AS (
        SELECT
          MIN(id) AS id,
          ARRAY_AGG(DISTINCT dnmk_brands_id) FILTER (WHERE dnmk_brands_id IS NOT NULL) AS dbrands_ids,
          MIN(ptdrk_brands_id) AS ptdrk_brands_id,
          COALESCE(
            MAX(ptbrand_name) FILTER (WHERE ptbrand_name IS NOT NULL),
            MAX(NULLIF(BTRIM(normalized_brand), '')),
            MIN(dinamik_brand) FILTER (WHERE dinamik_brand IS NOT NULL)
          ) AS brand_name,
          MAX(pt_url_key) AS pt_url_key,
          MAX(logo_url) FILTER (WHERE logo_url IS NOT NULL) AS logo_url
        FROM with_key
        GROUP BY group_key
      )
      SELECT g.id, g.dbrands_ids, g.ptdrk_brands_id, g.brand_name, g.pt_url_key, g.logo_url
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

