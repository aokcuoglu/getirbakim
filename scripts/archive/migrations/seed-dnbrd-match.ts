/**
 * Seed v0.brand_list workspace rows.
 *
 *   DRY_RUN=true bun scripts/seed-dnbrd-match.ts
 *   APPLY=true bun scripts/seed-dnbrd-match.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { auditDbrandsMatch, seedDbrandsMatchWorkspace } from '../lib/admin/dnbrd-match-seed'

const APPLY = process.env.APPLY === 'true'

async function ensureMigration() {
  await db.$executeRawUnsafe(`
    ALTER TABLE v0.brand_list
      ALTER COLUMN dnmk_brands_id DROP NOT NULL
  `)
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dpbrd_dbrand_only
      ON v0.brand_list (dnmk_brands_id)
      WHERE ptdrk_brands_id IS NULL AND dnmk_brands_id IS NOT NULL
  `)
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dpbrd_pt_only_mfr
      ON v0.brand_list (ptdrk_brands_id)
      WHERE dnmk_brands_id IS NULL AND ptdrk_brands_id IS NOT NULL
  `)
}

async function main() {
  console.log('[seed-dnbrd-match] Applying migration if needed...')
  await ensureMigration()

  console.log('[seed-dnbrd-match] Audit (before)')
  console.log(JSON.stringify(await auditDbrandsMatch(), null, 2))

  const result = await seedDbrandsMatchWorkspace({
    dryRun: !APPLY,
    runAutoMatch: true
  })

  console.log('[seed-dnbrd-match] Result')
  console.log(JSON.stringify(result, null, 2))
  console.log(APPLY ? 'APPLY tamamlandı.' : 'DRY_RUN — APPLY=true ile uygulayın.')
}

main().catch((error) => {
  console.error('[seed-dnbrd-match] Failed:', error)
  process.exit(1)
})
