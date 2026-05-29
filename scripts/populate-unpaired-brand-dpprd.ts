/**
 * Insert APPROVED single-side dpprd rows for products whose brand/manufacturer
 * is not under an approved paired dpbrd (both sides linked).
 *
 *   bun scripts/populate-unpaired-brand-dpprd.ts
 *   APPLY=true bun scripts/populate-unpaired-brand-dpprd.ts
 */

import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { insertApprovedDpmatchForUnpairedBrands } from '../lib/admin/dpprd-populate'
import { db } from '../lib/db'

const APPLY = process.env.APPLY === 'true'

async function main() {
  const before = await db.$queryRaw<
    Array<{
      total: number
      approved_single_side: number
      dinamik_only: number
      pt_only: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products) AS total,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products
        WHERE mapping_status = 'APPROVED'
          AND match_method = 'NO_BRAND_MATCH') AS approved_single_side,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products
        WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL) AS dinamik_only,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products
        WHERE dnmk_products_id IS NULL AND ptdrk_products_id IS NOT NULL) AS pt_only
  `)

  console.log('[populate-unpaired] Before:', before[0])
  console.log()

  const stats = await insertApprovedDpmatchForUnpairedBrands({ apply: APPLY })

  console.log(`[populate-unpaired] Dinamik-only candidates: ${stats.unpairedDproductCandidates}`)
  console.log(`[populate-unpaired] PT-only candidates:       ${stats.unpairedProductCandidates}`)

  if (!APPLY) {
    console.log('[populate-unpaired] DRY_RUN — set APPLY=true to insert.')
    return
  }

  console.log(`[populate-unpaired] Dinamik-only inserted:   ${stats.unpairedDproductInserted}`)
  console.log(`[populate-unpaired] PT-only inserted:        ${stats.unpairedProductInserted}`)

  const after = await db.$queryRaw<
    Array<{
      total: number
      approved_single_side: number
      dinamik_only: number
      pt_only: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products) AS total,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products
        WHERE mapping_status = 'APPROVED'
          AND match_method = 'NO_BRAND_MATCH') AS approved_single_side,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products
        WHERE dnmk_products_id IS NOT NULL AND ptdrk_products_id IS NULL) AS dinamik_only,
      (SELECT COUNT(*)::int FROM v0.dnmk_ptdrk_products
        WHERE dnmk_products_id IS NULL AND ptdrk_products_id IS NOT NULL) AS pt_only
  `)

  console.log('[populate-unpaired] After:', after[0])
}

main().catch((error) => {
  console.error('[populate-unpaired] Failed:', error)
  process.exit(1)
})
