/**
 * Reconcile v0.dnmk_brands:
 * - Remove rows that are only ParçaTedarik manufacturer names (not in dnprd.brand)
 * - Upsert missing rows from dnprd + optional Dinamik getBrandList API
 *
 *   DRY_RUN=true bun scripts/reconcile-dnbrd.ts
 *   APPLY=true bun scripts/reconcile-dnbrd.ts
 *   APPLY=true SYNC_API=false bun scripts/reconcile-dnbrd.ts
 *
 * API marka senkronu (getBrandList) için admin panelde getBrandList Test veya
 * runDinamikDbrandsReconcile({ apply: true }) kullanın — CLI'da SYNC_API server-only nedeniyle çalışmaz.
 */

import 'dotenv/config'
import { auditDbrands, reconcileDbrands } from '../lib/admin/dnbrd-reconcile'

const APPLY = process.env.APPLY === 'true'
const SYNC_API = process.env.SYNC_API !== 'false'

async function main() {
  console.log('[reconcile-dnbrd] Audit (before)')
  const before = await auditDbrands()
  console.log(JSON.stringify(before, null, 2))
  console.log()

  const result = await reconcileDbrands({
    dryRun: !APPLY,
    syncFromApi: SYNC_API
  })

  console.log('[reconcile-dnbrd] Result')
  console.log(JSON.stringify(result, null, 2))
  console.log()
  console.log(
    APPLY
      ? 'APPLY tamamlandı.'
      : 'DRY_RUN — uygulamak için: APPLY=true bun scripts/reconcile-dnbrd.ts'
  )
}

main().catch((error) => {
  console.error('[reconcile-dnbrd] Failed:', error)
  process.exit(1)
})
