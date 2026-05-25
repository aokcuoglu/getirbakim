import { db } from '@/lib/db'
import { normalizeModel } from '@/lib/matching/code-normalization'
import { Prisma } from '@prisma/client'

type ProductNormalizedSource = {
  normalized_model: string | null
  model: string | null
}

type DproductNormalizedSource = {
  part_no: string | null
}

export function resolveProductNormalized(source: ProductNormalizedSource): string | null {
  const fromColumn = source.normalized_model?.trim()
  if (fromColumn) return fromColumn
  return normalizeModel(source.model)
}

export function resolveDproductNormalized(source: DproductNormalizedSource): string | null {
  return normalizeModel(source.part_no)
}

/**
 * product_id wins when both sides are linked; otherwise dproducts.part_no.
 */
export function resolveDpmatchNormalized(input: {
  productId: number | null
  dproductsId: bigint | null
  product?: ProductNormalizedSource | null
  dproduct?: DproductNormalizedSource | null
}): string | null {
  if (input.productId != null && input.product) {
    return resolveProductNormalized(input.product)
  }
  if (input.dproductsId != null && input.dproduct) {
    return resolveDproductNormalized(input.dproduct)
  }
  return null
}

const NORMALIZED_VALUE_SQL = Prisma.sql`
  CASE
    WHEN m.product_id IS NOT NULL THEN COALESCE(
      NULLIF(BTRIM(p.normalized_model), ''),
      NULLIF(UPPER(REGEXP_REPLACE(COALESCE(p.model, ''), '[^A-Z0-9]', '', 'gi')), '')
    )
    WHEN m.dproducts_id IS NOT NULL THEN
      NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
    ELSE NULL
  END
`

/** Dinamik brand linked to a PT manufacturer in dbrands_match (both sides set, APPROVED). */
const DINAMIK_BRAND_HAS_APPROVED_MATCH = Prisma.sql`
  EXISTS (
    SELECT 1
    FROM parcatedarik.dbrands_match bm
    INNER JOIN parcatedarik.dbrands db ON db.id = bm.dbrands_id
    WHERE BTRIM(LOWER(db.brand)) = BTRIM(LOWER(d.brand))
      AND bm.manufacturer_id IS NOT NULL
      AND bm.mapping_status = 'APPROVED'
  )
`

/** PT manufacturer linked to a Dinamik brand in dbrands_match (both sides set, APPROVED). */
const PT_MANUFACTURER_HAS_APPROVED_MATCH = Prisma.sql`
  EXISTS (
    SELECT 1
    FROM parcatedarik.dbrands_match bm
    WHERE bm.manufacturer_id = p.manufacturer_id
      AND bm.manufacturer_id IS NOT NULL
      AND bm.dbrands_id IS NOT NULL
      AND bm.mapping_status = 'APPROVED'
  )
`

const NO_BRAND_MATCH_METHOD = 'NO_BRAND_MATCH'

/** Placeholder rows whose brand/manufacturer has no approved dbrands_match link. */
const UNMATCHED_BRAND_DPMATCH_FILTER = Prisma.sql`
  m.mapping_status = 'PENDING'
  AND (
    (
      m.dproducts_id IS NOT NULL
      AND m.product_id IS NULL
      AND d.brand IS NOT NULL
      AND BTRIM(d.brand) <> ''
      AND NOT ${DINAMIK_BRAND_HAS_APPROVED_MATCH}
    )
    OR (
      m.dproducts_id IS NULL
      AND m.product_id IS NOT NULL
      AND p.manufacturer_id IS NOT NULL
      AND NOT ${PT_MANUFACTURER_HAS_APPROVED_MATCH}
    )
  )
`

export async function updateDpmatchNormalizedForIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0

  return db.$executeRaw(Prisma.sql`
    UPDATE parcatedarik.dpmatch m
    SET normalized = src.val
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM parcatedarik.dpmatch m
      LEFT JOIN parcatedarik.product p ON p.id = m.product_id
      LEFT JOIN parcatedarik.dproducts d ON d.id = m.dproducts_id
      WHERE m.id IN (${Prisma.join(ids)})
    ) src
    WHERE m.id = src.id
      AND src.val IS NOT NULL
  `)
}

export async function approveDpmatchRows(
  ids: number[],
  options?: { matchMethod?: string | null; onlyPending?: boolean }
): Promise<number> {
  if (ids.length === 0) return 0

  const matchMethod = options?.matchMethod ?? null
  const onlyPending = options?.onlyPending ?? false
  const pendingFilter = onlyPending
    ? Prisma.sql`AND m.mapping_status = 'PENDING'`
    : Prisma.empty

  return db.$executeRaw(Prisma.sql`
    UPDATE parcatedarik.dpmatch m
    SET
      mapping_status = 'APPROVED',
      match_method = COALESCE(${matchMethod}, m.match_method),
      normalized = COALESCE(src.val, m.normalized)
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM parcatedarik.dpmatch m
      LEFT JOIN parcatedarik.product p ON p.id = m.product_id
      LEFT JOIN parcatedarik.dproducts d ON d.id = m.dproducts_id
      WHERE m.id IN (${Prisma.join(ids)})
      ${pendingFilter}
    ) src
    WHERE m.id = src.id
  `)
}

export async function backfillDpmatchNormalized(options?: {
  onlyEmpty?: boolean
  limit?: number
}): Promise<number> {
  const onlyEmpty = options?.onlyEmpty ?? true
  const limit = options?.limit

  const whereEmpty = onlyEmpty
    ? Prisma.sql`AND (m.normalized IS NULL OR BTRIM(m.normalized) = '')`
    : Prisma.empty
  const limitSql = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty

  return db.$executeRaw(Prisma.sql`
    UPDATE parcatedarik.dpmatch m
    SET normalized = src.val
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM parcatedarik.dpmatch m
      LEFT JOIN parcatedarik.product p ON p.id = m.product_id
      LEFT JOIN parcatedarik.dproducts d ON d.id = m.dproducts_id
      WHERE 1 = 1
      ${whereEmpty}
      ${limitSql}
    ) src
    WHERE m.id = src.id
      AND src.val IS NOT NULL
  `)
}

/**
 * Approve PENDING dpmatch placeholder rows when Dinamik brand or PT manufacturer
 * has no approved link in dbrands_match — no cross-platform match is possible.
 */
export async function approvePendingDpmatchWithoutBrandMatch(): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    UPDATE parcatedarik.dpmatch m
    SET
      mapping_status = 'APPROVED',
      match_method = COALESCE(m.match_method, ${NO_BRAND_MATCH_METHOD}),
      normalized = COALESCE(src.val, m.normalized)
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM parcatedarik.dpmatch m
      LEFT JOIN parcatedarik.dproducts d ON d.id = m.dproducts_id
      LEFT JOIN parcatedarik.product p ON p.id = m.product_id
      WHERE ${UNMATCHED_BRAND_DPMATCH_FILTER}
    ) src
    WHERE m.id = src.id
  `)
}

/**
 * Insert APPROVED dpmatch rows for Dinamik/PT products whose brand side is not
 * linked in dbrands_match yet.
 */
export async function insertApprovedDpmatchForUnmatchedBrands(): Promise<{
  dproductRows: number
  productRows: number
}> {
  const dproductRows = await db.$executeRaw(Prisma.sql`
    INSERT INTO parcatedarik.dpmatch (dproducts_id, product_id, mapping_status, match_method, normalized)
    SELECT
      d.id,
      NULL,
      'APPROVED',
      ${NO_BRAND_MATCH_METHOD},
      NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
    FROM parcatedarik.dproducts d
    WHERE d.brand IS NOT NULL
      AND BTRIM(d.brand) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM parcatedarik.dbrands_match bm
        WHERE EXISTS (
          SELECT 1
          FROM parcatedarik.dbrands db
          WHERE db.id = bm.dbrands_id
            AND BTRIM(LOWER(db.brand)) = BTRIM(LOWER(d.brand))
        )
          AND bm.manufacturer_id IS NOT NULL
          AND bm.mapping_status = 'APPROVED'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM parcatedarik.dpmatch m
        WHERE m.dproducts_id = d.id
      )
    ON CONFLICT (dproducts_id) WHERE dproducts_id IS NOT NULL DO NOTHING
  `)

  const productRows = await db.$executeRaw(Prisma.sql`
    INSERT INTO parcatedarik.dpmatch (dproducts_id, product_id, mapping_status, match_method, normalized)
    SELECT
      NULL,
      p.id,
      'APPROVED',
      ${NO_BRAND_MATCH_METHOD},
      COALESCE(
        NULLIF(BTRIM(p.normalized_model), ''),
        NULLIF(UPPER(REGEXP_REPLACE(COALESCE(p.model, ''), '[^A-Z0-9]', '', 'gi')), '')
      )
    FROM parcatedarik.product p
    WHERE p.manufacturer_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM parcatedarik.dbrands_match bm
        WHERE bm.manufacturer_id = p.manufacturer_id
          AND bm.manufacturer_id IS NOT NULL
          AND bm.dbrands_id IS NOT NULL
          AND bm.mapping_status = 'APPROVED'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM parcatedarik.dpmatch m
        WHERE m.product_id = p.id
      )
    ON CONFLICT (product_id) WHERE product_id IS NOT NULL DO NOTHING
  `)

  return { dproductRows, productRows }
}

export async function resolveNormalizedForLink(
  _dproductsId: bigint,
  productId: number
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ normalized_model: string | null; model: string | null }>>(
    Prisma.sql`
      SELECT p.normalized_model, p.model
      FROM parcatedarik.product p
      WHERE p.id = ${productId}
      LIMIT 1
    `
  )

  const product = rows[0]
  if (!product) return null

  return resolveProductNormalized(product)
}
