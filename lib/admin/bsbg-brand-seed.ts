import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const MATCH_METHOD_BSBG = 'BSBG_AUTO'
const MAPPING_STATUS_APPROVED = 'APPROVED'
const MAPPING_STATUS_PENDING = 'PENDING'

export interface BsbgBrandSeedStats {
  totalBsbgBrands: number
  alreadyLinked: number
  matchedToCanonical: number
  mergedIntoExisting: number
  newRowsInserted: number
  unmatchedInserted: number
  unmatchedBrands: number
}

export async function seedBsbgBrandMappings(
  options?: { apply?: boolean; onProgress?: (message: string) => void }
): Promise<BsbgBrandSeedStats> {
  const apply = options?.apply ?? false
  const log = options?.onProgress ?? ((message: string) => console.log(message))

  const stats: BsbgBrandSeedStats = {
    totalBsbgBrands: 0,
    alreadyLinked: 0,
    matchedToCanonical: 0,
    mergedIntoExisting: 0,
    newRowsInserted: 0,
    unmatchedInserted: 0,
    unmatchedBrands: 0,
  }

  // ------------------------------------------------------------------
  // 1. Toplam bsbg_brands + zaten linked olanlar
  // ------------------------------------------------------------------
  const allBsbgBrands = await db.$queryRaw<Array<{ brand: string; id: bigint }>>(Prisma.sql`
    SELECT brand, id FROM v0.bsbg_brands ORDER BY brand
  `)

  const linkedRows = await db.$queryRaw<Array<{ bsbg_brands_id: bigint }>>(Prisma.sql`
    SELECT DISTINCT bsbg_brands_id FROM v0.brand_mappings WHERE bsbg_brands_id IS NOT NULL
  `)

  stats.totalBsbgBrands = allBsbgBrands.length
  stats.alreadyLinked = linkedRows.length

  const linkedSet = new Set(linkedRows.map((r) => Number(r.bsbg_brands_id)))
  const unlinkedBsbgBrands = allBsbgBrands.filter((r) => !linkedSet.has(Number(r.id)))

  log(
    `[bsbg-brand-seed] Total ${stats.totalBsbgBrands} bsbg_brands, ${stats.alreadyLinked} already linked, ${unlinkedBsbgBrands.length} unlinked`
  )

  if (!apply || unlinkedBsbgBrands.length === 0) {
    return stats
  }

  // ------------------------------------------------------------------
  // 2. Unlinked bsbg_brands → brand_list normalize match
  // ------------------------------------------------------------------
  const candidates = await db.$queryRaw<
    Array<{
      bsbg_brand: string
      bsbg_id: bigint
      canonical_id: number
      canonical_brand: string
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (bb.brand)
      bb.brand             AS bsbg_brand,
      bb.id                AS bsbg_id,
      dpb.id               AS canonical_id,
      dpb.brand AS canonical_brand
    FROM (VALUES ${Prisma.join(
      unlinkedBsbgBrands.map((r) => Prisma.sql`(${r.brand}, ${r.id}::bigint)`)
    )}) AS v(brand, id)
    JOIN v0.bsbg_brands bb ON bb.id = v.id
    JOIN v0.brand_list dpb
      ON REGEXP_REPLACE(UPPER(bb.brand), '[^A-Z0-9]', '', 'g')
       = REGEXP_REPLACE(UPPER(dpb.brand), '[^A-Z0-9]', '', 'g')
    ORDER BY bb.brand,
      CASE WHEN bb.brand = dpb.brand THEN 0 ELSE 1 END
  `)

  stats.matchedToCanonical = candidates.length
  log(`[bsbg-brand-seed] ${stats.matchedToCanonical} unlinked brands match existing brand_list`)

  // ------------------------------------------------------------------
  // 3. Merge matched bsbg brands into existing brand_mappings rows
  //    (only update rows where bsbg_brands_id is NULL)
  // ------------------------------------------------------------------
  if (candidates.length > 0) {
    // 3a. Choose the best existing mapping row for each canonical brand
    //     where bsbg_brands_id is NULL.
    const targetRows = await db.$queryRaw<
      Array<{
        canonical_id: number
        bsbg_id: bigint
        target_mapping_id: number
      }>
    >(Prisma.sql`
      WITH bsbg_ordered AS (
        SELECT DISTINCT ON (v.bsbg_id)
          v.canonical_id,
          v.bsbg_id
        FROM (VALUES ${Prisma.join(
          candidates.map((r) => Prisma.sql`(${r.canonical_id}::int, ${r.bsbg_id}::bigint)`)
        )}) AS v(canonical_id, bsbg_id)
      ),
      best_existing AS (
        SELECT DISTINCT ON (b.canonical_id)
          b.canonical_id,
          b.bsbg_id,
          m.id AS target_mapping_id
        FROM bsbg_ordered b
        JOIN v0.brand_mappings m
          ON m.brand_list_id = b.canonical_id
         AND m.bsbg_brands_id IS NULL
        ORDER BY b.canonical_id,
          CASE WHEN m.match_method = 'EXACT_NORMALIZED' THEN 0 ELSE 1 END,
          CASE WHEN m.dnmk_brands_id IS NOT NULL OR m.ptdrk_brands_id IS NOT NULL THEN 0 ELSE 1 END,
          m.id
      )
      SELECT * FROM best_existing
    `)

    if (targetRows.length > 0) {
      stats.mergedIntoExisting = Number(
        await db.$executeRaw(Prisma.sql`
          UPDATE v0.brand_mappings m
          SET bsbg_brands_id = v.bsbg_id
          FROM (VALUES ${Prisma.join(
            targetRows.map((r) => Prisma.sql`(${r.target_mapping_id}::int, ${r.bsbg_id}::bigint)`)
          )}) AS v(mapping_id, bsbg_id)
          WHERE m.id = v.mapping_id
        `)
      )
      log(`[bsbg-brand-seed] Merged ${stats.mergedIntoExisting} bsbg brands into existing mapping rows`)
    }

    // 3b. Some bsbg brands may share a canonical_id where the chosen
    //     existing mapping already got a bsbg_brands_id from another
    //     bsbg brand → insert a new row for the remainder.
    const mergedBsbgIds = new Set(targetRows.map((r) => Number(r.bsbg_id)))
    const needNewRow = candidates.filter((r) => !mergedBsbgIds.has(Number(r.bsbg_id)))

    if (needNewRow.length > 0) {
      stats.newRowsInserted = Number(
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.brand_mappings
            (brand_list_id, bsbg_brands_id, mapping_status, match_method)
          SELECT v.canonical_id, v.bsbg_id, ${MAPPING_STATUS_APPROVED}, ${MATCH_METHOD_BSBG}
          FROM (VALUES ${Prisma.join(
            needNewRow.map((r) => Prisma.sql`(${r.canonical_id}::int, ${r.bsbg_id}::bigint)`)
          )}) AS v(canonical_id, bsbg_id)
          ON CONFLICT (brand_list_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id)
            WHERE dnmk_brands_id IS NULL AND ptdrk_brands_id IS NULL AND bsbg_brands_id IS NOT NULL
            DO NOTHING
        `)
      )
      log(`[bsbg-brand-seed] Inserted ${stats.newRowsInserted} new APPROVED mapping rows`)
    }
  }

  // ------------------------------------------------------------------
  // 4. Unmatched unlinked bsbg brands — insert into canonical + PENDING mapping
  // ------------------------------------------------------------------
  const matchedSet = new Set(candidates.map((r) => r.bsbg_brand))
  const unmatched = unlinkedBsbgBrands.filter((r) => !matchedSet.has(r.brand))

  stats.unmatchedBrands = unmatched.length

  if (unmatched.length > 0) {
    // 4a. Insert unmatched brand names as new canonical brands
    await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.brand_list (brand)
      SELECT UPPER(BTRIM(v.brand))
      FROM (VALUES ${Prisma.join(unmatched.map((r) => Prisma.sql`(${r.brand})`))}) AS v(brand)
      WHERE NOT EXISTS (
        SELECT 1 FROM v0.brand_list dpb
        WHERE dpb.brand = UPPER(BTRIM(v.brand))
      )
    `)

    // 4b. Fetch back the canonical ids
    const inserted = await db.$queryRaw<
      Array<{ bsbg_id: bigint; canonical_id: number }>
    >(Prisma.sql`
      SELECT bb.id AS bsbg_id, dpb.id AS canonical_id
      FROM (VALUES ${Prisma.join(unmatched.map((r) => Prisma.sql`(${r.id}::bigint)`))}) AS v(bsbg_id)
      JOIN v0.bsbg_brands bb ON bb.id = v.bsbg_id
      JOIN v0.brand_list dpb
        ON REGEXP_REPLACE(UPPER(bb.brand), '[^A-Z0-9]', '', 'g')
         = REGEXP_REPLACE(UPPER(dpb.brand), '[^A-Z0-9]', '', 'g')
      WHERE NOT EXISTS (
        SELECT 1 FROM v0.brand_mappings m
        WHERE m.brand_list_id = dpb.id AND m.bsbg_brands_id = bb.id
      )
    `)

    // 4c. Insert PENDING mappings
    if (inserted.length > 0) {
      stats.unmatchedInserted = Number(
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.brand_mappings
            (brand_list_id, bsbg_brands_id, mapping_status)
          SELECT v.canonical_id, v.bsbg_id, ${MAPPING_STATUS_PENDING}
          FROM (VALUES ${Prisma.join(
            inserted.map((r) => Prisma.sql`(${r.canonical_id}::int, ${r.bsbg_id}::bigint)`)
          )}) AS v(canonical_id, bsbg_id)
          ON CONFLICT (brand_list_id, dnmk_brands_id, ptdrk_brands_id, bsbg_brands_id)
            WHERE dnmk_brands_id IS NULL AND ptdrk_brands_id IS NULL AND bsbg_brands_id IS NOT NULL
            DO NOTHING
        `)
      )
      log(`[bsbg-brand-seed] Inserted ${stats.unmatchedInserted} PENDING mappings for unmatched bsbg brands`)
    }
  }

  return stats
}