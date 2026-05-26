/**
 * Remove redundant dbrands_match rows superseded by paired matches.
 *
 *   bun scripts/cleanup-redundant-dbrands-match.ts
 *   APPLY=true bun scripts/cleanup-redundant-dbrands-match.ts
 */

import 'dotenv/config'
import {
  countRedundantDinamikStubs,
  countRedundantPtOnlyRows,
  removeRedundantDbrandsMatchRows,
} from '../lib/admin/dbrands-match-cleanup'

const APPLY = process.env.APPLY === 'true'

async function main() {
  const dinamikStubs = await countRedundantDinamikStubs()
  const ptOnlyRows = await countRedundantPtOnlyRows()
  console.log('[cleanup-redundant-dbrands-match] Before:', { dinamikStubs, ptOnlyRows })

  if (!APPLY) {
    console.log('[cleanup-redundant-dbrands-match] DRY_RUN — set APPLY=true to delete.')
    return
  }

  const removed = await removeRedundantDbrandsMatchRows()
  console.log('[cleanup-redundant-dbrands-match] Removed:', removed)
}

main().catch((error) => {
  console.error('[cleanup-redundant-dbrands-match] Failed:', error)
  process.exit(1)
})
