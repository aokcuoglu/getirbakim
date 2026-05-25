/**
 * Backfill v0.dpmatch.normalized from linked product/dproduct data.
 *
 * Rules:
 * - product_id present (matched or PT-only): normalize(model)
 * - dproducts_id only (Dinamik-only approved): normalize(dproducts.part_no)
 *
 * Usage:
 *   bun scripts/backfill-dpmatch-normalized.ts
 *   APPLY=true bun scripts/backfill-dpmatch-normalized.ts
 *   APPLY=true LIMIT=1000 bun scripts/backfill-dpmatch-normalized.ts
 *   APPLY=true REFRESH=true bun scripts/backfill-dpmatch-normalized.ts
 *   APPLY=true APPROVE_UNMATCHED=true bun scripts/backfill-dpmatch-normalized.ts
 */

import 'dotenv/config'
import {
  approvePendingDpmatchWithoutBrandMatch,
  backfillDpmatchNormalized,
  insertApprovedDpmatchForUnmatchedBrands,
} from '../lib/admin/dpmatch-normalized'
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const DRY_RUN = process.env.APPLY !== 'true'
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined
const REFRESH = process.env.REFRESH === 'true'
const APPROVE_UNMATCHED = process.env.APPROVE_UNMATCHED === 'true'

async function main() {
  const countResult = await db.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM v0.dpmatch m
      WHERE ${REFRESH ? Prisma.sql`TRUE` : Prisma.sql`(m.normalized IS NULL OR BTRIM(m.normalized) = '')`}
    `
  )
  const pending = Number(countResult[0]?.count ?? 0)

  console.log('[backfill-dpmatch-normalized] Starting')
  console.log(`  mode:        ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log(`  only empty:  ${!REFRESH}`)
  console.log(`  limit:       ${LIMIT ?? 'none'}`)
  console.log(`  approve unmatched brands: ${APPROVE_UNMATCHED}`)
  console.log(`  candidates:  ${pending.toLocaleString('tr-TR')}`)

  if (DRY_RUN) {
    console.log('[backfill-dpmatch-normalized] Dry run complete. Set APPLY=true to write.')
    await db.$disconnect()
    return
  }

  const updated = await backfillDpmatchNormalized({
    onlyEmpty: !REFRESH,
    limit: LIMIT,
  })

  console.log(`[backfill-dpmatch-normalized] Updated ${updated.toLocaleString('tr-TR')} normalized rows`)

  if (APPROVE_UNMATCHED) {
    const inserted = await insertApprovedDpmatchForUnmatchedBrands()
    const approved = await approvePendingDpmatchWithoutBrandMatch()
    console.log(
      `[backfill-dpmatch-normalized] Unmatched brands: inserted dproduct=${inserted.dproductRows}, product=${inserted.productRows}, approved pending=${approved}`
    )
  }

  await db.$disconnect()
}

main().catch((error) => {
  console.error('[backfill-dpmatch-normalized] Fatal:', error)
  process.exit(1)
})
