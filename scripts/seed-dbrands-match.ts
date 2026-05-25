/**
 * Seed v0.dbrands_match workspace rows.
 *
 *   DRY_RUN=true bun scripts/seed-dbrands-match.ts
 *   APPLY=true bun scripts/seed-dbrands-match.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { auditDbrandsMatch, seedDbrandsMatchWorkspace } from '../lib/admin/dbrands-match-seed'

const APPLY = process.env.APPLY === 'true'

async function ensureMigration() {
  await db.$executeRawUnsafe(`
    ALTER TABLE v0.dbrands_match
      ALTER COLUMN dbrands_id DROP NOT NULL
  `)
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_dbrand_only
      ON v0.dbrands_match (dbrands_id)
      WHERE ptbrands_id IS NULL AND dbrands_id IS NOT NULL
  `)
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dbrands_match_pt_only_mfr
      ON v0.dbrands_match (ptbrands_id)
      WHERE dbrands_id IS NULL AND ptbrands_id IS NOT NULL
  `)
}

async function main() {
  console.log('[seed-dbrands-match] Applying migration if needed...')
  await ensureMigration()

  console.log('[seed-dbrands-match] Audit (before)')
  console.log(JSON.stringify(await auditDbrandsMatch(), null, 2))

  const result = await seedDbrandsMatchWorkspace({
    dryRun: !APPLY,
    runAutoMatch: true
  })

  console.log('[seed-dbrands-match] Result')
  console.log(JSON.stringify(result, null, 2))
  console.log(APPLY ? 'APPLY tamamlandı.' : 'DRY_RUN — APPLY=true ile uygulayın.')
}

main().catch((error) => {
  console.error('[seed-dbrands-match] Failed:', error)
  process.exit(1)
})
