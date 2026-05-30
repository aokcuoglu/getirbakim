import { db } from '@/lib/db'
import { normalizeModel } from '@/lib/matching/code-normalization'
import {
  dproductNotUnderPairedApprovedBrand,
  ptproductNotUnderPairedApprovedBrand,
  SINGLE_SIDE_APPROVED_MATCH_METHOD,
} from '@/lib/sql/dpprd-exact'
import { insertApprovedDpmatchForUnpairedBrands } from '@/lib/admin/dpprd-populate'
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
 * ptdrk_products_id wins when both sides are linked; otherwise dnprd.part_no.
 */
export function resolveDpmatchNormalized(input: {
  productId: number | null
  dnprdId: bigint | null
  product?: ProductNormalizedSource | null
  dproduct?: DproductNormalizedSource | null
}): string | null {
  if (input.productId != null && input.product) {
    return resolveProductNormalized(input.product)
  }
  if (input.dnprdId != null && input.dproduct) {
    return resolveDproductNormalized(input.dproduct)
  }
  return null
}

const NORMALIZED_VALUE_SQL = Prisma.sql`
  CASE
    WHEN m.ptdrk_products_id IS NOT NULL THEN ${ptproductNormalizedModelExpr}
    WHEN m.dnmk_products_id IS NOT NULL THEN
      NULLIF(UPPER(REGEXP_REPLACE(COALESCE(d.part_no, ''), '[^A-Z0-9]', '', 'gi')), '')
    ELSE NULL
  END
`

const NO_BRAND_MATCH_METHOD = SINGLE_SIDE_APPROVED_MATCH_METHOD

/** Placeholder rows whose brand/manufacturer has no approved paired dpbrd link. */
const UNMATCHED_BRAND_DPMATCH_FILTER = Prisma.sql`
  m.mapping_status = 'PENDING'
  AND (
    (
      m.dnmk_products_id IS NOT NULL
      AND m.ptdrk_products_id IS NULL
      AND d.dnmk_brands_id IS NOT NULL
      AND ${dproductNotUnderPairedApprovedBrand}
    )
    OR (
      m.dnmk_products_id IS NULL
      AND m.ptdrk_products_id IS NOT NULL
      AND p.ptdrk_brands_id IS NOT NULL
      AND ${ptproductNotUnderPairedApprovedBrand}
    )
  )
`

export async function updateDpmatchNormalizedForIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0

  return db.$executeRaw(Prisma.sql`
    UPDATE v0.product_list m
    SET normalized_name = src.val
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.product_list m
      LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
      LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
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
    UPDATE v0.product_list m
    SET
      mapping_status = 'APPROVED',
      match_method = COALESCE(${matchMethod}, m.match_method),
      normalized_name = COALESCE(src.val, m.normalized_name)
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.product_list m
      LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
      LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
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
    ? Prisma.sql`AND (m.normalized_name IS NULL OR BTRIM(m.normalized_name) = '')`
    : Prisma.empty
  const limitSql = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty

  return db.$executeRaw(Prisma.sql`
    UPDATE v0.product_list m
    SET normalized_name = src.val
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.product_list m
      LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
      LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      WHERE 1 = 1
      ${whereEmpty}
      ${limitSql}
    ) src
    WHERE m.id = src.id
      AND src.val IS NOT NULL
  `)
}

/**
 * Approve PENDING dpprd placeholder rows when Dinamik brand or PT manufacturer
 * has no approved link in dpbrd — no cross-platform match is possible.
 */
export async function approvePendingDpmatchWithoutBrandMatch(): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    UPDATE v0.product_list m
    SET
      mapping_status = 'APPROVED',
      match_method = COALESCE(m.match_method, ${NO_BRAND_MATCH_METHOD}),
      normalized_name = COALESCE(src.val, m.normalized_name)
    FROM (
      SELECT
        m.id,
        ${NORMALIZED_VALUE_SQL} AS val
      FROM v0.product_list m
      LEFT JOIN v0.dnmk_products d ON d.id = m.dnmk_products_id
      LEFT JOIN v0.ptdrk_products p ON p.id = m.ptdrk_products_id
      WHERE ${UNMATCHED_BRAND_DPMATCH_FILTER}
    ) src
    WHERE m.id = src.id
  `)
}

/**
 * Insert APPROVED dpprd rows for Dinamik/PT products whose brand side lacks
 * an approved paired dpbrd link.
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
  _dnprdId: bigint,
  productId: number
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ model: string | null }>>(
    Prisma.sql`
      SELECT p.part_no AS model
      FROM v0.ptdrk_products p
      WHERE p.id = ${productId}
      LIMIT 1
    `
  )

  const product = rows[0]
  if (!product) return null

  return resolveProductNormalized(product)
}
