import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const MATCH_METHOD_BSBG = 'BSBG_AUTO'
const MAPPING_STATUS_APPROVED = 'APPROVED'
const MAPPING_STATUS_PENDING = 'PENDING'

/**
 * Seed bsbg_brands into brand_mappings.
 *
 * For matched brands: updates the existing mapping row (e.g. EXACT_NORMALIZED)
 * by setting bsbg_brands_id, instead of creating a separate row.
 * For unmatched brands: creates new canonical + PENDING mapping.
 *
 *   DRY_RUN=true  bun scripts/seed-bsbg-brand-mapping.ts   (default)
 *   APPLY=true    bun scripts/seed-bsbg-brand-mapping.ts
 */

async function main() {
  const APPLY = process.env.APPLY === 'true'

  // ------------------------------------------------------------------
  //  Cleanup: remove BSBG_AUTO + PENDING-only stub rows from previous run
  // ------------------------------------------------------------------
  if (APPLY) {
    // Reset all bsbg_brands_id references and drop stub rows from
    // a previous run so the script is idempotent.
    await db.$executeRaw(Prisma.sql`
      UPDATE v0.brand_mappings SET bsbg_brands_id = NULL
      WHERE bsbg_brands_id IS NOT NULL
    `)
    const deleted = await db.$executeRaw(Prisma.sql`
      DELETE FROM v0.brand_mappings
      WHERE match_method = ${MATCH_METHOD_BSBG}
         OR mapping_status = ${MAPPING_STATUS_PENDING}
    `)
    console.log(`[bsbg-brand-mapping] Reset bsbg_brands_id, deleted ${deleted} stub rows`)

    // Remove orphan canonical brands created for previous unmatched bsbg brands
    await db.$executeRaw(Prisma.sql`
      DELETE FROM v0.brand_list dpb
      WHERE NOT EXISTS (
        SELECT 1 FROM v0.brand_mappings m
        WHERE m.brand_list_id = dpb.id
      )
      AND dpb.brand IN (
        SELECT brand FROM v0.bsbg_brands
      )
    `)
  }

  // ------------------------------------------------------------------
  //  1. Match bsbg_brands.brand -> brand_list.brand
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
    FROM v0.bsbg_brands bb
    JOIN v0.brand_list dpb
      ON REGEXP_REPLACE(UPPER(bb.brand), '[^A-Z0-9]', '', 'g')
       = REGEXP_REPLACE(UPPER(dpb.brand), '[^A-Z0-9]', '', 'g')
    ORDER BY bb.brand,
      CASE WHEN bb.brand = dpb.brand THEN 0 ELSE 1 END
  `)

  const matchedSet = new Set(candidates.map((r) => r.bsbg_brand))

  console.log(`[bsbg-brand-mapping] Candidates matched: ${candidates.length}`)

  // ------------------------------------------------------------------
  //  2. Merge matched bsbg brands into existing mapping rows
  //     (prefer EXACT_NORMALIZED, then any non-BSBG row for the same
  //      canonical brand).
  // ------------------------------------------------------------------
  let mergedCount = 0
  let newRowCount = 0

  if (candidates.length > 0 && APPLY) {
    // 2a. Choose the best existing mapping row for each canonical brand.
    //     For each (bsbg_brand) we want at most one row to update.
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
          candidates.map(
            (r) => Prisma.sql`(${r.canonical_id}::int, ${r.bsbg_id}::bigint)`
          )
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
         AND m.id NOT IN (
           SELECT id FROM v0.brand_mappings
           WHERE match_method = ${MATCH_METHOD_BSBG}
         )
         AND (m.dnmk_brands_id IS NOT NULL OR m.ptdrk_brands_id IS NOT NULL)
        ORDER BY b.canonical_id,
          CASE WHEN m.match_method = 'EXACT_NORMALIZED' THEN 0 ELSE 1 END,
          CASE WHEN m.bsbg_brands_id IS NULL THEN 0 ELSE 1 END,
          m.id
      )
      SELECT * FROM best_existing
    `)

    // 2b. Update those existing rows with bsbg_brands_id
    if (targetRows.length > 0) {
      mergedCount = Number(
        await db.$executeRaw(Prisma.sql`
          UPDATE v0.brand_mappings m
          SET bsbg_brands_id = v.bsbg_id
          FROM (VALUES ${Prisma.join(
            targetRows.map(
              (r) => Prisma.sql`(${r.target_mapping_id}::int, ${r.bsbg_id}::bigint)`
            )
          )}) AS v(mapping_id, bsbg_id)
          WHERE m.id = v.mapping_id
        `)
      )
    }

    // 2c. Some bsbg brands may share a canonical_id where the chosen
    //     existing mapping already got a bsbg_brands_id from another
    //     bsbg brand → insert a new row for the remainder.
    const mergedBsbgIds = new Set(targetRows.map((r) => Number(r.bsbg_id)))
    const needNewRow = candidates.filter(
      (r) => !mergedBsbgIds.has(Number(r.bsbg_id))
    )

    if (needNewRow.length > 0) {
      newRowCount = Number(
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.brand_mappings
            (brand_list_id, bsbg_brands_id, mapping_status, match_method)
          SELECT v.canonical_id, v.bsbg_id, ${MAPPING_STATUS_APPROVED}, ${MATCH_METHOD_BSBG}
          FROM (VALUES ${Prisma.join(
            needNewRow.map(
              (r) => Prisma.sql`(${r.canonical_id}::int, ${r.bsbg_id}::bigint)`
            )
          )}) AS v(canonical_id, bsbg_id)
          ON CONFLICT (brand_list_id, bsbg_brands_id)
            WHERE dnmk_brands_id IS NULL AND ptdrk_brands_id IS NULL AND bsbg_brands_id IS NOT NULL
            DO NOTHING
        `)
      )
    }
  }

  console.log(`[bsbg-brand-mapping] Merged into existing rows: ${mergedCount}`)
  console.log(`[bsbg-brand-mapping] New rows inserted:         ${newRowCount}`)

  // ------------------------------------------------------------------
  //  3. Unmatched bsbg brands — insert into canonical + mapping
  // ------------------------------------------------------------------
  const allBsbgBrands = await db.$queryRaw<
    Array<{ brand: string; id: bigint }>
  >(Prisma.sql`
    SELECT brand, id FROM v0.bsbg_brands ORDER BY brand
  `)
  const unmatchedBrands = allBsbgBrands.filter((r) => !matchedSet.has(r.brand))

  console.log(`[bsbg-brand-mapping] Unmatched brands: ${unmatchedBrands.length}`)

  let waitingInserted = 0
  if (unmatchedBrands.length > 0 && APPLY) {
    // 3a. Insert unmatched brand names as new canonical brands
    await db.$executeRaw(Prisma.sql`
      INSERT INTO v0.brand_list (brand)
      SELECT UPPER(BTRIM(v.brand))
      FROM (VALUES ${Prisma.join(
        unmatchedBrands.map((r) => Prisma.sql`(${r.brand})`)
      )}) AS v(brand)
      WHERE NOT EXISTS (
        SELECT 1 FROM v0.brand_list dpb
        WHERE dpb.brand = UPPER(BTRIM(v.brand))
      )
    `)

    // 3b. Fetch back the canonical ids
    const inserted = await db.$queryRaw<
      Array<{ bsbg_id: bigint; canonical_id: number }>
    >(Prisma.sql`
      SELECT bb.id AS bsbg_id, dpb.id AS canonical_id
      FROM v0.bsbg_brands bb
      JOIN v0.brand_list dpb
        ON REGEXP_REPLACE(UPPER(bb.brand), '[^A-Z0-9]', '', 'g')
         = REGEXP_REPLACE(UPPER(dpb.brand), '[^A-Z0-9]', '', 'g')
      WHERE bb.id IN (${Prisma.join(unmatchedBrands.map((r) => r.id))})
    `)

    // 3c. Insert PENDING mappings
    if (inserted.length > 0) {
      waitingInserted = Number(
        await db.$executeRaw(Prisma.sql`
          INSERT INTO v0.brand_mappings
            (brand_list_id, bsbg_brands_id, mapping_status)
          SELECT v.canonical_id, v.bsbg_id, ${MAPPING_STATUS_PENDING}
          FROM (VALUES ${Prisma.join(
            inserted.map(
              (r) => Prisma.sql`(${r.canonical_id}::int, ${r.bsbg_id}::bigint)`
            )
          )}) AS v(canonical_id, bsbg_id)
          ON CONFLICT (brand_list_id, bsbg_brands_id)
            WHERE dnmk_brands_id IS NULL AND ptdrk_brands_id IS NULL AND bsbg_brands_id IS NOT NULL
            DO NOTHING
        `)
      )
    }
  }

  // ------------------------------------------------------------------
  //  4. Summary
  // ------------------------------------------------------------------
  console.log('')
  console.log('=== BSBG Brand Mapping Summary ===')
  console.log(`Total bsbg_brands:           ${allBsbgBrands.length}`)
  console.log(`Matched:                     ${candidates.length}`)
  console.log(`  - Merged into existing:    ${mergedCount}`)
  console.log(`  - New rows (fallback):     ${newRowCount}`)
  console.log(`Unmatched (PENDING):         ${unmatchedBrands.length}`)
  console.log(`  - Inserted:                ${waitingInserted}`)
  console.log('')
  console.log(APPLY ? 'APPLY completed.' : 'DRY RUN — use APPLY=true to apply.')

  if (!APPLY) {
    console.log('')
    console.log('--- Matched brands (will be merged into existing mapping) ---')
    for (const r of candidates) {
      console.log(`  ${r.bsbg_brand} (bsbg_id=${r.bsbg_id}) -> ${r.canonical_brand} (id=${r.canonical_id})`)
    }
    console.log('')
    console.log('--- Unmatched brands (will be PENDING) ---')
    for (const r of unmatchedBrands) {
      console.log(`  ${r.brand} (bsbg_id=${r.id})`)
    }
  }
}

main().catch((err) => {
  console.error('[bsbg-brand-mapping] Failed:', err)
  process.exit(1)
})
