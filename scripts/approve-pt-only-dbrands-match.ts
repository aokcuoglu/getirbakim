/**
 * Approve PT-only dbrands_match rows (Dinamik bekliyor) without linking dbrands_id.
 *
 *   bun scripts/approve-pt-only-dbrands-match.ts
 *   APPLY=true bun scripts/approve-pt-only-dbrands-match.ts
 */

import 'dotenv/config'
import { Prisma } from '@prisma/client'
import {
  approvePendingPtOnlyDbrandsMatch,
  countPendingPtOnlyDbrandsMatch,
} from '../lib/admin/dbrands-match-approve'
import { db } from '../lib/db'

const APPLY = process.env.APPLY === 'true'

async function main() {
  const pending = await countPendingPtOnlyDbrandsMatch()
  console.log(`[approve-pt-only] PENDING PT-only rows (dbrands_id NULL): ${pending}`)

  if (!APPLY) {
    console.log('[approve-pt-only] DRY_RUN — set APPLY=true to approve.')
    return
  }

  const updated = await approvePendingPtOnlyDbrandsMatch()

  const [after] = await db.$queryRaw<
    Array<{
      pending_pt_only: number
      approved_pt_only: number
      approved_paired: number
    }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM v0.dbrands_match
        WHERE dbrands_id IS NULL AND ptbrands_id IS NOT NULL AND mapping_status = 'PENDING') AS pending_pt_only,
      (SELECT COUNT(*)::int FROM v0.dbrands_match
        WHERE dbrands_id IS NULL AND ptbrands_id IS NOT NULL AND mapping_status = 'APPROVED') AS approved_pt_only,
      (SELECT COUNT(*)::int FROM v0.dbrands_match
        WHERE dbrands_id IS NOT NULL AND ptbrands_id IS NOT NULL AND mapping_status = 'APPROVED') AS approved_paired
  `)

  console.log(`[approve-pt-only] Approved: ${updated}`)
  console.log('[approve-pt-only] After:', after)
}

main().catch((error) => {
  console.error('[approve-pt-only] Failed:', error)
  process.exit(1)
})
