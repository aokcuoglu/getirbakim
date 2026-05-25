/**
 * Populate v0.dpmatch under approved paired dbrands_match rows.
 *
 * Rules:
 * - Brand prerequisite: dbrands_match with BOTH dbrands_id AND ptbrands_id, APPROVED
 * - Auto-match: normalized(dproducts.part_no) = normalized(ptproducts.model)
 * - Optional placeholders for unmatched products under paired brands (PLACEHOLDERS=false to skip)
 *
 * Usage:
 *   bun scripts/generate-dinamik-parcatedarik-model-matches.ts          # dry-run counts
 *   APPLY=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 *   APPLY=true CLEAN=true bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 *   APPLY=true PLACEHOLDERS=false bun scripts/generate-dinamik-parcatedarik-model-matches.ts
 *
 * Repopulate strategy for legacy rows (~522k placeholders from old logic):
 *   1. Dry-run to see exact match candidate count
 *   2. APPLY=true CLEAN=true PLACEHOLDERS=false  — exact matches only, drop invalid rows
 *   3. APPLY=true PLACEHOLDERS=true              — add pending rows for manual review
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { populateDpmatch } from '../lib/admin/dpmatch-populate'

const DRY_RUN = process.env.APPLY !== 'true'
const CLEAN = process.env.CLEAN === 'true'
const PLACEHOLDERS = process.env.PLACEHOLDERS !== 'false'

async function main() {
  console.log('[generate-dpmatch] Populate dpmatch — paired brands, part_no = model')
  console.log(`[generate-dpmatch] MODE = ${DRY_RUN ? 'DRY_RUN' : 'APPLY'}`)
  console.log(`[generate-dpmatch] CLEAN invalid rows = ${CLEAN}`)
  console.log(`[generate-dpmatch] PLACEHOLDERS = ${PLACEHOLDERS}`)
  console.log()

  const stats = await populateDpmatch({
    apply: !DRY_RUN,
    includePlaceholders: PLACEHOLDERS,
    cleanInvalid: CLEAN,
    onProgress: (message) => console.log(message.replace('[dpmatch-populate]', '[generate-dpmatch]')),
  })

  console.log()
  console.log('=== Summary ===')
  console.log(`  Paired brand matches:  ${stats.brandMatches}`)
  console.log(`  Exact match candidates: ${stats.exactMatchCandidates}`)
  if (!DRY_RUN) {
    console.log(`  Exact inserted:        ${stats.exactMatchesInserted}`)
    console.log(`  Exact updated:         ${stats.exactMatchesUpdated}`)
    console.log(`  Orphan rows deleted:   ${stats.orphanRowsDeleted}`)
    if (CLEAN) console.log(`  Invalid rows deleted:  ${stats.invalidRowsDeleted}`)
    if (PLACEHOLDERS) {
      console.log(`  Dinamik placeholders:  ${stats.dproductPlaceholders}`)
      console.log(`  PT placeholders:       ${stats.productPlaceholders}`)
      console.log(`  Placeholders inserted: ${stats.inserted}`)
    }
  } else if (PLACEHOLDERS) {
    console.log(`  Would add Dinamik placeholders: ${stats.dproductPlaceholders}`)
    console.log(`  Would add PT placeholders:      ${stats.productPlaceholders}`)
  }
  console.log('[generate-dpmatch] Done.')
  await db.$disconnect()
}

main().catch((err) => {
  console.error('[generate-dpmatch] Fatal:', err)
  process.exit(1)
})
