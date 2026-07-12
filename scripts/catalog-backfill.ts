/**
 * Backfill / resync the catalog schema from the raw supplier layer.
 *
 *   bun scripts/catalog-backfill.ts            # match + offers + OEMs + rollups
 *   bun scripts/catalog-backfill.ts --enrich   # ... then enrich from public.parts
 *
 * Idempotent — the same pipeline the catalog cron endpoints run, so it can be
 * executed repeatedly; a second consecutive run should report 0 new rows.
 */
import { runCatalogSyncPipeline } from '../lib/catalog/sync-pipeline'
import { enrichFromParts } from '../lib/catalog/enrich-from-parts'

async function main() {
  const withEnrich = process.argv.includes('--enrich')

  console.log('Starting catalog backfill...')
  const result = await runCatalogSyncPipeline({
    onProgress: (msg) => console.log(msg)
  })
  console.log('Pipeline result:', JSON.stringify(result, null, 2))

  if (withEnrich) {
    console.log('Starting parts enrichment...')
    const enrichment = await enrichFromParts({
      onProgress: (msg) => console.log(msg)
    })
    console.log('Enrichment result:', JSON.stringify(enrichment, null, 2))
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
