import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  dpprdExactPartNoModelFilter,
  dproductNormalizedPartNoExpr,
  dproductNotUnderPairedApprovedBrand,
  pairedApprovedBrandMatchFilter,
  ptproductNotUnderPairedApprovedBrand,
  SINGLE_SIDE_APPROVED_MATCH_METHOD,
} from '@/lib/sql/dpprd-exact'
import { ptproductNormalizedModelExpr } from '@/lib/sql/ptproduct-model'

export interface DpmatchPopulateStats {
  brandMatches: number
  exactMatchCandidates: number
  exactMatchesInserted: number
  exactMatchesUpdated: number
  orphanRowsDeleted: number
  dproductPlaceholders: number
  productPlaceholders: number
  inserted: number
  skipped: number
  invalidRowsDeleted: number
  unpairedDproductCandidates: number
  unpairedProductCandidates: number
  unpairedDproductInserted: number
  unpairedProductInserted: number
}

export function createEmptyDpmatchPopulateStats(): DpmatchPopulateStats {
  return {
    brandMatches: 0,
    exactMatchCandidates: 0,
    exactMatchesInserted: 0,
    exactMatchesUpdated: 0,
    orphanRowsDeleted: 0,
    dproductPlaceholders: 0,
    productPlaceholders: 0,
    inserted: 0,
    skipped: 0,
    invalidRowsDeleted: 0,
    unpairedDproductCandidates: 0,
    unpairedProductCandidates: 0,
    unpairedDproductInserted: 0,
    unpairedProductInserted: 0,
  }
}

/** Count exact-match pairs under approved paired brand matches (part_no = model). */
export async function countExactDpmatchCandidates(): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM v0.brand_mappings m
    JOIN v0.brand_list cb ON cb.id = m.brand_list_id
    INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = m.dnmk_brands_id
    INNER JOIN v0.ptdrk_products p ON p.ptdrk_brands_id = m.ptdrk_brands_id
    WHERE ${pairedApprovedBrandMatchFilter}
      AND ${dpprdExactPartNoModelFilter}
  `)
  return Number(rows[0]?.count ?? 0)
}

/**
 * Remove dpprd rows whose products are not under an approved paired brand match,
 * or placeholder rows for brands that only have a single-side dpbrd.
 */
export async function deleteInvalidDpmatchRows(): Promise<number> {
  return db.$executeRaw(Prisma.sql`
    DELETE FROM v0.product_list m
    WHERE NOT (
      m.mapping_status = 'APPROVED'
      AND m.match_method = ${SINGLE_SIDE_APPROVED_MATCH_METHOD}
      AND (
        (m.dnmk_products_id IS NOT NULL AND m.ptdrk_products_id IS NULL)
        OR (m.dnmk_products_id IS NULL AND m.ptdrk_products_id IS NOT NULL)
      )
    )
    AND (
      (
        m.dnmk_products_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM v0.dnmk_products d
          INNER JOIN v0.brand_mappings bm ON bm.dnmk_brands_id = d.dnmk_brands_id
          JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
          WHERE d.id = m.dnmk_products_id
            AND ${pairedApprovedBrandMatchFilter}
        )
      )
      OR (
        m.ptdrk_products_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM v0.ptdrk_products p
          INNER JOIN v0.brand_mappings bm ON bm.ptdrk_brands_id = p.ptdrk_brands_id
          JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
          WHERE p.id = m.ptdrk_products_id
            AND ${pairedApprovedBrandMatchFilter}
        )
      )
    )
  `)
}

const EXACT_MATCH_PAIRS_CTE = Prisma.sql`
  WITH pairs AS (
    SELECT
      d.id AS dnmk_products_id,
      p.id AS ptdrk_products_id,
      ${dproductNormalizedPartNoExpr} AS normalized
    FROM v0.brand_mappings bm
    JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
    INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = bm.dnmk_brands_id
    INNER JOIN v0.ptdrk_products p ON p.ptdrk_brands_id = bm.ptdrk_brands_id
    WHERE ${pairedApprovedBrandMatchFilter}
      AND ${dpprdExactPartNoModelFilter}
  )
`

async function applyBulkExactMatches(stats: DpmatchPopulateStats): Promise<void> {
  const orphanDelete = await db.$executeRaw(Prisma.sql`
    ${EXACT_MATCH_PAIRS_CTE}
    DELETE FROM v0.product_list m
    USING pairs p
    WHERE m.dnmk_products_id IS NULL
      AND m.ptdrk_products_id = p.ptdrk_products_id
  `)
  stats.orphanRowsDeleted += orphanDelete

  const updatedRows = await db.$executeRaw(Prisma.sql`
    ${EXACT_MATCH_PAIRS_CTE}
    UPDATE v0.product_list m
    SET
      mapping_status = 'APPROVED',
      match_method = 'EXACT_MATCH',
      normalized_name = p.normalized
    FROM pairs p
    WHERE m.dnmk_products_id = p.dnmk_products_id
      AND m.ptdrk_products_id = p.ptdrk_products_id
  `)
  stats.exactMatchesUpdated += updatedRows

  const insertedRows = await db.$executeRaw(Prisma.sql`
    ${EXACT_MATCH_PAIRS_CTE}
    INSERT INTO v0.product_list (
      dnmk_products_id, ptdrk_products_id, mapping_status, match_method, normalized_name
    )
    SELECT
      p.dnmk_products_id,
      p.ptdrk_products_id,
      'APPROVED',
      'EXACT_MATCH',
      p.normalized
    FROM pairs p
    WHERE NOT EXISTS (
      SELECT 1
      FROM v0.product_list m
      WHERE m.dnmk_products_id = p.dnmk_products_id
        AND m.ptdrk_products_id = p.ptdrk_products_id
    )
    ON CONFLICT (dnmk_products_id, ptdrk_products_id)
      WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NOT NULL
    DO NOTHING
  `)
  stats.exactMatchesInserted += insertedRows

  const placeholderCleanup = await db.$executeRaw(Prisma.sql`
    DELETE FROM v0.product_list m
    WHERE m.dnmk_products_id IS NOT NULL
      AND m.ptdrk_products_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM v0.product_list paired
        WHERE paired.dnmk_products_id = m.dnmk_products_id
          AND paired.ptdrk_products_id IS NOT NULL
          AND paired.id <> m.id
      )
  `)
  stats.orphanRowsDeleted += placeholderCleanup
}

async function insertUnmatchedPlaceholders(
  stats: DpmatchPopulateStats,
  apply: boolean
): Promise<void> {
  const dproductCount = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM v0.brand_mappings bm
    JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
    INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = bm.dnmk_brands_id
    WHERE ${pairedApprovedBrandMatchFilter}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.dnmk_products_id = d.id
      )
  `)
  stats.dproductPlaceholders = Number(dproductCount[0]?.count ?? 0)

  const productCount = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM v0.brand_mappings bm
    JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
    INNER JOIN v0.ptdrk_products p ON p.ptdrk_brands_id = bm.ptdrk_brands_id
    WHERE ${pairedApprovedBrandMatchFilter}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.ptdrk_products_id = p.id
      )
  `)
  stats.productPlaceholders = Number(productCount[0]?.count ?? 0)

  if (!apply) return

  const dproductInserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_list (dnmk_products_id, ptdrk_products_id, mapping_status, normalized_name)
    SELECT
      d.id,
      NULL,
      'PENDING',
      ${dproductNormalizedPartNoExpr}
    FROM v0.brand_mappings bm
    JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
    INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = bm.dnmk_brands_id
    WHERE ${pairedApprovedBrandMatchFilter}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.dnmk_products_id = d.id
      )
    ON CONFLICT (dnmk_products_id) WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL DO NOTHING
  `)
  stats.inserted += dproductInserted

  const productInserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_list (dnmk_products_id, ptdrk_products_id, mapping_status, normalized_name)
    SELECT
      NULL,
      p.id,
      'PENDING',
      ${ptproductNormalizedModelExpr}
    FROM v0.brand_mappings bm
    JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
    INNER JOIN v0.ptdrk_products p ON p.ptdrk_brands_id = bm.ptdrk_brands_id
    WHERE ${pairedApprovedBrandMatchFilter}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.ptdrk_products_id = p.id
      )
    ON CONFLICT (ptdrk_products_id) WHERE dnmk_products_id IS NULL AND ptdrk_products_id IS NOT NULL DO NOTHING
  `)
  stats.inserted += productInserted
}

/** Count dnprd not under an approved paired brand match and missing from dpprd. */
export async function countUnpairedBrandDproductCandidates(): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM v0.dnmk_products d
    WHERE d.dnmk_brands_id IS NOT NULL
      AND ${dproductNotUnderPairedApprovedBrand}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.dnmk_products_id = d.id
      )
  `)
  return Number(rows[0]?.count ?? 0)
}

/** Count ptprd not under an approved paired brand match and missing from dpprd. */
export async function countUnpairedBrandProductCandidates(): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM v0.ptdrk_products p
    WHERE p.ptdrk_brands_id IS NOT NULL
      AND ${ptproductNotUnderPairedApprovedBrand}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.ptdrk_products_id = p.id
      )
  `)
  return Number(rows[0]?.count ?? 0)
}

/**
 * Insert APPROVED single-side dpprd rows for products whose brand/manufacturer
 * is not under an approved paired dpbrd (both sides linked).
 */
export async function insertApprovedDpmatchForUnpairedBrands(options?: {
  apply?: boolean
}): Promise<Pick<
  DpmatchPopulateStats,
  'unpairedDproductCandidates' | 'unpairedProductCandidates' | 'unpairedDproductInserted' | 'unpairedProductInserted'
>> {
  const apply = options?.apply ?? false
  const stats = {
    unpairedDproductCandidates: await countUnpairedBrandDproductCandidates(),
    unpairedProductCandidates: await countUnpairedBrandProductCandidates(),
    unpairedDproductInserted: 0,
    unpairedProductInserted: 0,
  }

  if (!apply) return stats

  stats.unpairedDproductInserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_list (dnmk_products_id, ptdrk_products_id, mapping_status, match_method, normalized_name)
    SELECT
      d.id,
      NULL,
      'APPROVED',
      ${SINGLE_SIDE_APPROVED_MATCH_METHOD},
      ${dproductNormalizedPartNoExpr}
    FROM v0.dnmk_products d
    WHERE d.dnmk_brands_id IS NOT NULL
      AND ${dproductNotUnderPairedApprovedBrand}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.dnmk_products_id = d.id
      )
    ON CONFLICT (dnmk_products_id) WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL DO NOTHING
  `)

  stats.unpairedProductInserted = await db.$executeRaw(Prisma.sql`
    INSERT INTO v0.product_list (dnmk_products_id, ptdrk_products_id, mapping_status, match_method, normalized_name)
    SELECT
      NULL,
      p.id,
      'APPROVED',
      ${SINGLE_SIDE_APPROVED_MATCH_METHOD},
      ${ptproductNormalizedModelExpr}
    FROM v0.ptdrk_products p
    WHERE p.ptdrk_brands_id IS NOT NULL
      AND ${ptproductNotUnderPairedApprovedBrand}
      AND NOT EXISTS (
        SELECT 1 FROM v0.product_list m WHERE m.ptdrk_products_id = p.id
      )
    ON CONFLICT (ptdrk_products_id) WHERE dnmk_products_id IS NULL AND ptdrk_products_id IS NOT NULL DO NOTHING
  `)

  return stats
}

export async function populateDpmatch(options?: {
  apply?: boolean
  includePlaceholders?: boolean
  cleanInvalid?: boolean
  onProgress?: (message: string) => void
}): Promise<DpmatchPopulateStats> {
  const apply = options?.apply ?? false
  const includePlaceholders = options?.includePlaceholders ?? true
  const cleanInvalid = options?.cleanInvalid ?? false
  const log = options?.onProgress ?? ((message: string) => console.log(message))
  const stats = createEmptyDpmatchPopulateStats()

  const brandMatchRows = await db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM v0.brand_mappings bm
    JOIN v0.brand_list cb ON cb.id = bm.brand_list_id
    WHERE ${pairedApprovedBrandMatchFilter}
  `)
  stats.brandMatches = Number(brandMatchRows[0]?.count ?? 0)
  log(`[dpprd-populate] ${stats.brandMatches} approved paired brand matches`)

  if (cleanInvalid && apply) {
    stats.invalidRowsDeleted = await deleteInvalidDpmatchRows()
    log(`[dpprd-populate] Deleted ${stats.invalidRowsDeleted} invalid rows`)
  }

  stats.exactMatchCandidates = await countExactDpmatchCandidates()
  log(`[dpprd-populate] ${stats.exactMatchCandidates} exact match candidates (part_no = model)`)

  if (apply) {
    await applyBulkExactMatches(stats)
    log(
      `[dpprd-populate] Exact matches: ${stats.exactMatchesInserted} inserted, ${stats.exactMatchesUpdated} updated, ${stats.orphanRowsDeleted} orphan PT rows removed`
    )
  }

  if (includePlaceholders) {
    await insertUnmatchedPlaceholders(stats, apply)
    log(
      `[dpprd-populate] Unmatched placeholders: ${stats.dproductPlaceholders} Dinamik-only, ${stats.productPlaceholders} PT-only`
    )
  }

  return stats
}
