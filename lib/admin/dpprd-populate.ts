import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  dpprdExactPartNoModelFilter,
  pairedApprovedBrandMatchFilter
} from '@/lib/sql/dpprd-exact'

export interface DpprdPopulateStats {
  /** Number of candidate dnmk↔ptdrk pairs discovered by the query. */
  candidates: number
  /** Number of new product_mappings rows actually inserted (skips existing/conflicts). */
  inserted: number
  /** Number of approved paired brand mappings used as the join basis. */
  brandPairs: number
}

/**
 * Populate v0.product_mappings with dnmk ↔ ptdrk candidate pairs.
 *
 * Pairs are derived from approved brand_mappings (both dnmk_brands_id and
 * ptdrk_brands_id set, mapping_status='APPROVED') joined to dnmk_products
 * and ptdrk_products where the normalized part_no values match exactly
 * (dpprdExactPartNoModelFilter) and ptdrk.ref_no carries data.
 *
 * Existing pairs are skipped (ON CONFLICT DO NOTHING) so this is idempotent
 * and safe to run repeatedly. Rows are inserted with mapping_status='PENDING'
 * and match_method='PART_NO_EXACT'; approval (and the OEM bridge write) is
 * a separate, explicit action.
 */
export async function populateDpprdMatches(options?: {
  apply?: boolean
  limit?: number
  onProgress?: (message: string) => void
}): Promise<DpprdPopulateStats> {
  const apply = options?.apply ?? false
  const limit = options?.limit
  const log = options?.onProgress ?? ((message: string) => console.log(message))

  const stats: DpprdPopulateStats = {
    candidates: 0,
    inserted: 0,
    brandPairs: 0
  }

  // 1. Count approved paired brand matches (dnmk + ptdrk under same brand_list).
  const brandCount = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS n
    FROM v0.brand_mappings bm
    WHERE ${pairedApprovedBrandMatchFilter}
  `)
  stats.brandPairs = Number(brandCount[0]?.n ?? 0)
  log(`[dpprd-populate] ${stats.brandPairs} approved paired brand matches`)

  if (stats.brandPairs === 0) return stats

  // 2. Find candidate pairs (part_no exact match under approved paired brands,
  //    ptdrk.ref_no populated). We fetch the candidate rows first to report
  //    an accurate count and to support a dry-run preview.
  const limitClause = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty

  const candidates = await db.$queryRaw<
    Array<{
      brand_list_id: number
      dnmk_products_id: bigint
      ptdrk_products_id: number
    }>
  >(Prisma.sql`
    SELECT
      bm.brand_list_id,
      d.id AS dnmk_products_id,
      p.id AS ptdrk_products_id
    FROM v0.brand_mappings bm
    INNER JOIN v0.dnmk_products d ON d.dnmk_brands_id = bm.dnmk_brands_id
    INNER JOIN v0.ptdrk_products p ON p.ptdrk_brands_id = bm.ptdrk_brands_id
    WHERE ${pairedApprovedBrandMatchFilter}
      AND ${dpprdExactPartNoModelFilter}
      AND p.ref_no IS NOT NULL
      AND BTRIM(p.ref_no) <> ''
    ${limitClause}
  `)

  stats.candidates = candidates.length
  log(`[dpprd-populate] ${stats.candidates} dnmk+ptdrk pairs with matching part_no`)

  if (!apply || candidates.length === 0) return stats

  // 3. Bulk insert with ON CONFLICT DO NOTHING. We split into chunks to keep
  //    parameter counts within Postgres' 65555-parameter limit and to bound
  //    transaction size. Each row contributes 3 params (brand_list_id,
  //    dnmk_products_id, ptdrk_products_id) plus the status literal:
  const CHUNK_SIZE = 1000
  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE)
    const tuples = chunk.map(
      (c) =>
        Prisma.sql`(${c.brand_list_id}, ${c.dnmk_products_id}, ${c.ptdrk_products_id}, 'PENDING')`
    )
    const valuesSql = Prisma.join(tuples)

    const result = await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.product_mappings
        (brand_list_id, dnmk_products_id, ptdrk_products_id, mapping_status)
      VALUES ${valuesSql}
      ON CONFLICT (dnmk_products_id, ptdrk_products_id) DO NOTHING
    `)
    stats.inserted += Number(result)
  }

  log(`[dpprd-populate] Inserted ${stats.inserted} new product_mappings rows`)

  return stats
}