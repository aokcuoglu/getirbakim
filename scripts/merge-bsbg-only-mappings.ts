import 'dotenv/config'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

function stringifyReplacer(_key: string, value: any) {
  return typeof value === 'bigint' ? value.toString() : value
}

async function main() {
  const APPLY = process.env.APPLY === 'true'

  // ------------------------------------------------------------------
  //  1. Find the 16 orphaned rows and the best target row per brand_list_id
  // ------------------------------------------------------------------
  const plan = await db.$queryRaw<
    Array<{
      orphan_id: number
      brand_list_id: number
      bsbg_to_move: bigint
      target_id: number
      target_existing_bsbg: bigint | null
      target_dnmk: bigint | null
      target_ptdrk: bigint | null
    }>
  >`
    WITH orphaned AS (
      SELECT id, brand_list_id, bsbg_brands_id
      FROM v0.brand_mappings bm
      WHERE bm.bsbg_brands_id IS NOT NULL
        AND bm.dnmk_brands_id IS NULL
        AND bm.ptdrk_brands_id IS NULL
        AND EXISTS (
          SELECT 1 FROM v0.brand_mappings other
          WHERE other.brand_list_id = bm.brand_list_id
            AND other.id != bm.id
            AND (other.dnmk_brands_id IS NOT NULL OR other.ptdrk_brands_id IS NOT NULL)
        )
    ),
    targets AS (
      SELECT DISTINCT ON (brand_list_id)
        id AS target_id,
        brand_list_id,
        dnmk_brands_id,
        ptdrk_brands_id,
        bsbg_brands_id AS target_existing_bsbg
      FROM v0.brand_mappings
      WHERE brand_list_id IN (SELECT brand_list_id FROM orphaned)
        AND (dnmk_brands_id IS NOT NULL OR ptdrk_brands_id IS NOT NULL)
      ORDER BY brand_list_id,
        CASE WHEN bsbg_brands_id IS NULL THEN 0 ELSE 1 END,
        id
    )
    SELECT
      o.id AS orphan_id,
      o.brand_list_id,
      o.bsbg_brands_id AS bsbg_to_move,
      t.target_id,
      t.target_existing_bsbg,
      t.dnmk_brands_id AS target_dnmk,
      t.ptdrk_brands_id AS target_ptdrk
    FROM orphaned o
    JOIN targets t ON t.brand_list_id = o.brand_list_id
    ORDER BY o.brand_list_id
  `

  console.log(`Found ${plan.length} orphaned rows to merge:\n`)
  for (const row of plan) {
    const hasBsbg = row.target_existing_bsbg != null ? 'YES' : 'NULL'
    console.log(
      `brand_list_id=${row.brand_list_id}  ` +
      `orphan=${row.orphan_id}(bsbg=${row.bsbg_to_move})  ` +
      `-> target=${row.target_id}  ` +
      `(existing_bsbg=${hasBsbg}, dnmk=${row.target_dnmk}, ptdrk=${row.target_ptdrk})`
    )
  }

  if (plan.length === 0) {
    console.log('Nothing to do.')
    return
  }

  // Safety check: do not overwrite existing bsbg unless explicitly allowed
  const overwriteTargets = plan.filter(r => r.target_existing_bsbg != null)
  if (overwriteTargets.length > 0) {
    console.warn(`\nWARNING: ${overwriteTargets.length} target rows already have a bsbg_brands_id.`)
    console.warn('These would be OVERWRITTEN. Review carefully:')
    for (const r of overwriteTargets) {
      console.warn(`  target_id=${r.target_id} brand_list_id=${r.brand_list_id} current_bsbg=${r.target_existing_bsbg} new_bsbg=${r.bsbg_to_move}`)
    }
    console.warn('\nTo proceed anyway, set ALLOW_OVERWRITE=true in addition to APPLY=true.')
  }

  if (!APPLY) {
    console.log('\nDRY RUN — set APPLY=true to execute.')
    return
  }

  const allowOverwrite = process.env.ALLOW_OVERWRITE === 'true'
  const toUpdate = allowOverwrite
    ? plan
    : plan.filter(r => r.target_existing_bsbg == null)

  if (toUpdate.length === 0) {
    console.log('No targets with empty bsbg_brands_id to update. Set ALLOW_OVERWRITE=true if you want to overwrite existing bsbg values.')
    return
  }

  // ------------------------------------------------------------------
  //  2. Update target rows
  // ------------------------------------------------------------------
  for (const row of toUpdate) {
    const result = await db.$executeRaw`
      UPDATE v0.brand_mappings
      SET bsbg_brands_id = ${row.bsbg_to_move}
      WHERE id = ${row.target_id}
    `
    console.log(`Updated target ${row.target_id} with bsbg=${row.bsbg_to_move} (rows affected: ${result})`)
  }

  // ------------------------------------------------------------------
  //  3. Delete the orphaned rows
  // ------------------------------------------------------------------
  const orphanIds = toUpdate.map(r => r.orphan_id)
  const deleted = await db.$executeRaw`
    DELETE FROM v0.brand_mappings
    WHERE id IN (${Prisma.join(orphanIds)})
  `
  console.log(`\nDeleted ${deleted} orphaned rows.`)

  console.log(`\nDone. Merged ${toUpdate.length} bsbg entries and removed ${deleted} redundant rows.`)
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
