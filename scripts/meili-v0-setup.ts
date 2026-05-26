/**
 * Meilisearch v0 catalog index setup (dpmatch + dbrands_match).
 *
 * Usage:
 *   bun run search:v0:setup
 *   MEILI_HOST=http://127.0.0.1:7700 MEILI_MASTER_KEY=... bun run search:v0:setup
 */

import { MeiliSearch } from 'meilisearch'

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || ''
const INDEX_NAME = process.env.MEILI_INDEX_V0 || 'v0-catalog'

async function main() {
  if (!MEILI_MASTER_KEY) {
    console.error('[meili-v0-setup] MEILI_MASTER_KEY is required.')
    process.exit(1)
  }

  console.log(`[meili-v0-setup] Connecting to ${MEILI_HOST}`)
  const client = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY })
  const health = await client.health()
  console.log(`[meili-v0-setup] Health: ${health.status}`)

  const task = await client.createIndex(INDEX_NAME, { primaryKey: 'id' })
  console.log(`[meili-v0-setup] createIndex task: ${task.taskUid}`)

  const index = client.index(INDEX_NAME)
  const settingsTask = await index.updateSettings({
    searchableAttributes: [
      'brandName',
      'name',
      'title',
      'model',
      'sku',
      'refNo',
      'rawText',
      'oemCodes',
      'searchableText',
      'detailUrl'
    ],
    filterableAttributes: ['documentType', 'brandName', 'matchId'],
    sortableAttributes: ['price', 'stockQty', 'matchId'],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 }
    },
    pagination: { maxTotalHits: 50000 }
  })
  console.log(`[meili-v0-setup] settings task: ${settingsTask.taskUid}`)
  console.log('[meili-v0-setup] Done. Run: bun run search:v0:reindex')
}

main().catch((error) => {
  console.error('[meili-v0-setup] Fatal:', error)
  process.exit(1)
})
