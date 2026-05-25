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
