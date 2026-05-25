import { db } from '@/lib/db'
import { normalizeModel } from '@/lib/matching/code-normalization'
import {
  dproductNotUnderPairedApprovedBrand,
  ptproductNotUnderPairedApprovedBrand,
  SINGLE_SIDE_APPROVED_MATCH_METHOD,
} from '@/lib/sql/dpmatch-exact'
import { insertApprovedDpmatchForUnpairedBrands } from '@/lib/admin/dpmatch-populate'
import { ptproductNormalizedModelExpr } from '@/lib/sql/ptproduct-model'
import { Prisma } from '@prisma/client'

type ProductNormalizedSource = {
  model: string | null
}

type DproductNormalizedSource = {
  part_no: string | null
}

export function resolveProductNormalized(source: ProductNormalizedSource): string | null {
  return normalizeModel(source.model)
}

export function resolveDproductNormalized(source: DproductNormalizedSource): string | null {
  return normalizeModel(source.part_no)
}

/**
 * ptproducts_id wins when both sides are linked; otherwise dproducts.part_no.
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
    WHEN m.ptproducts_id IS NOT NULL THEN ${ptproductNormalizedModelExpr}
    WHEN m.dproducts_id IS NOT NULL THEN
      NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
    ELSE NULL
  END
`

const NO_BRAND_MATCH_METHOD = SINGLE_SIDE_APPROVED_MATCH_METHOD

/** Placeholder rows whose brand/manufacturer has no approved paired dbrands_match link. */
const UNMATCHED_BRAND_DPMATCH_FILTER = Prisma.sql`
  m.mapping_status = 'PENDING'
  AND (
    (
      m.dproducts_id IS NOT NULL
      AND m.ptproducts_id IS NULL
      AND d.dbrands_id IS NOT NULL
      AND ${dproductNotUnderPairedApprovedBrand}
    )
    OR (
      m.dproducts_id IS NULL
      AND m.ptproducts_id IS NOT NULL
      AND p.ptbrands_id IS NOT NULL
      AND ${ptproductNotUnderPairedApprovedBrand}
    )
  )
`

export async function updateDpmatchNormalizedForIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0

  return db.$executeRaw(Prisma.sql`
    UPDATE v0.dpmatch m
    SET normalized = src.val
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.dpmatch m
      LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
      LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
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
    UPDATE v0.dpmatch m
    SET
      mapping_status = 'APPROVED',
      match_method = COALESCE(${matchMethod}, m.match_method),
      normalized = COALESCE(src.val, m.normalized)
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.dpmatch m
      LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
      LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
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
    UPDATE v0.dpmatch m
    SET normalized = src.val
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.dpmatch m
      LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
      LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
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
    UPDATE v0.dpmatch m
    SET
      mapping_status = 'APPROVED',
      match_method = COALESCE(m.match_method, ${NO_BRAND_MATCH_METHOD}),
      normalized = COALESCE(src.val, m.normalized)
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.dpmatch m
      LEFT JOIN v0.dproducts d ON d.id = m.dproducts_id
      LEFT JOIN v0.ptproducts p ON p.id = m.ptproducts_id
      WHERE ${UNMATCHED_BRAND_DPMATCH_FILTER}
    ) src
    WHERE m.id = src.id
  `)
}

/**
 * Insert APPROVED dpmatch rows for Dinamik/PT products whose brand side lacks
 * an approved paired dbrands_match link.
 */
export async function insertApprovedDpmatchForUnmatchedBrands(): Promise<{
  dproductRows: number
  productRows: number
}> {
  const stats = await insertApprovedDpmatchForUnpairedBrands({ apply: true })
  return {
    dproductRows: stats.unpairedDproductInserted,
    productRows: stats.unpairedProductInserted,
  }
}

export async function resolveNormalizedForLink(
  _dproductsId: bigint,
  productId: number
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ model: string | null }>>(
    Prisma.sql`
      SELECT p.model
      FROM v0.ptproducts p
      WHERE p.id = ${productId}
      LIMIT 1
    `
  )

  const product = rows[0]
  if (!product) return null

  return resolveProductNormalized(product)
}
