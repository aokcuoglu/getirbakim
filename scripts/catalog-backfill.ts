/**
 * Backfill / resync the catalog schema from the raw supplier layer.
 *
 *   bun scripts/catalog-backfill.ts            # match + offers + OEMs + rollups
 *
 * Idempotent — the same pipeline the catalog cron endpoints run, so it can be
 * executed repeatedly; a second consecutive run should report 0 new rows.
 *
 * `--enrich` KALDIRILDI (eski enrichFromParts() kopyalama tasarımıyla birlikte
 * silindi). public.parts köprüsü artık iki ayrı adım:
 *   bun scripts/link-catalog-products-to-parts.ts   # link kur
 *   bun scripts/derive-oems-from-part-links.ts      # OEM türet
 * Görsel/özellik/araç uyumu kopyalanmaz; lib/catalog/part-enrichment.ts
 * CONFIRMED link'ler üzerinden read-through okur.
 */
import { runCatalogSyncPipeline } from '../lib/catalog/sync-pipeline'

async function main() {
  if (process.argv.includes('--enrich')) {
    console.error(
      '--enrich kaldırıldı. Sırasıyla: bun scripts/link-catalog-products-to-parts.ts, ' +
        'ardından bun scripts/derive-oems-from-part-links.ts'
    )
    process.exit(1)
  }

  console.log('Starting catalog backfill...')
  const result = await runCatalogSyncPipeline({
    onProgress: (msg) => console.log(msg)
  })
  console.log('Pipeline result:', JSON.stringify(result, null, 2))

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
