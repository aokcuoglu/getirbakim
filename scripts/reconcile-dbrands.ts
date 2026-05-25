/**
 * Reconcile v0.dbrands:
 * - Remove rows that are only ParçaTedarik manufacturer names (not in dproducts.brand)
 * - Upsert missing rows from dproducts + optional Dinamik getBrandList API
 *
 *   DRY_RUN=true bun scripts/reconcile-dbrands.ts
 *   APPLY=true bun scripts/reconcile-dbrands.ts
 *   APPLY=true SYNC_API=false bun scripts/reconcile-dbrands.ts
 *
 * API marka senkronu (getBrandList) için admin panelde getBrandList Test veya
 * runDinamikDbrandsReconcile({ apply: true }) kullanın — CLI'da SYNC_API server-only nedeniyle çalışmaz.
 */

import 'dotenv/config'
import { auditDbrands, reconcileDbrands } from '../lib/admin/dbrands-reconcile'

const APPLY = process.env.APPLY === 'true'
const SYNC_API = process.env.SYNC_API !== 'false'

async function main() {
  console.log('[reconcile-dbrands] Audit (before)')
  const before = await auditDbrands()
  console.log(JSON.stringify(before, null, 2))
  console.log()

  const result = await reconcileDbrands({
    dryRun: !APPLY,
    syncFromApi: SYNC_API
  })

  console.log('[reconcile-dbrands] Result')
  console.log(JSON.stringify(result, null, 2))
  console.log()
  console.log(
    APPLY
      ? 'APPLY tamamlandı.'
      : 'DRY_RUN — uygulamak için: APPLY=true bun scripts/reconcile-dbrands.ts'
  )
}

main().catch((error) => {
  console.error('[reconcile-dbrands] Failed:', error)
  process.exit(1)
})
