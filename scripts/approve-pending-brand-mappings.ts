/**
 * Approve all PENDING brand_mappings rows.
 *
 *   bun scripts/approve-pending-brand-mappings.ts        (dry-run)
 *   APPLY=true bun scripts/approve-pending-brand-mappings.ts
 */

import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { db } from '../lib/db'

const APPLY = process.env.APPLY === 'true'

async function main() {
  const [before] = await db.$queryRaw<
    Array<{ pending:bigint; approved:bigint; rejected:bigint; ignored:bigint }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM v0.brand_mappings WHERE mapping_status = 'PENDING')  AS pending,
      (SELECT COUNT(*) FROM v0.brand_mappings WHERE mapping_status = 'APPROVED') AS approved,
      (SELECT COUNT(*) FROM v0.brand_mappings WHERE mapping_status = 'REJECTED') AS rejected,
      (SELECT COUNT(*) FROM v0.brand_mappings WHERE mapping_status = 'IGNORED')  AS ignored
  `)

  console.log('[approve-pending] Before:', before)

  if (!APPLY) {
    console.log('[approve-pending] DRY_RUN — set APPLY=true to approve.')
    return
  }

  const result = await db.$executeRaw(
    Prisma.sql`UPDATE v0.brand_mappings SET mapping_status = 'APPROVED' WHERE mapping_status = 'PENDING'`
  )

  const [after] = await db.$queryRaw<
    Array<{ pending:bigint; approved:bigint }>
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM v0.brand_mappings WHERE mapping_status = 'PENDING')  AS pending,
      (SELECT COUNT(*) FROM v0.brand_mappings WHERE mapping_status = 'APPROVED') AS approved
  `)

  console.log(`[approve-pending] Updated: ${result}`)
  console.log('[approve-pending] After:', after)
}

main().catch((error) => {
  console.error('[approve-pending] Failed:', error)
  process.exit(1)
})