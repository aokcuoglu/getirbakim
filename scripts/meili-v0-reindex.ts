/**
 * Reindex v0 catalog (approved dpmatch products + grouped dbrands_match) into Meilisearch.
 *
 * Usage:
 *   bun run search:v0:reindex
 *   MEILI_REINDEX_CLEAR=true bun run search:v0:reindex
 *
 * Env:
 *   MEILI_HOST, MEILI_MASTER_KEY, MEILI_INDEX_V0 (default: v0-catalog)
 *   MEILI_REINDEX_CLEAR=true — delete all documents before reindex
 *   MEILI_REINDEX_BATCH_SIZE=500
 */

import { MeiliSearch } from 'meilisearch'
import {
  fetchV0MeiliBrandDocuments,
  fetchV0MeiliProductDocumentsPage
} from '../lib/v0/search/v0-search-document'

const PRODUCT_FETCH_BATCH = parseInt(
  process.env.MEILI_REINDEX_FETCH_BATCH_SIZE || '2000',
  10
)

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || ''
const INDEX_NAME = process.env.MEILI_INDEX_V0 || 'v0-catalog'
const BATCH_SIZE = parseInt(process.env.MEILI_REINDEX_BATCH_SIZE || '250', 10)
const TASK_WAIT_MS = parseInt(process.env.MEILI_REINDEX_TASK_WAIT_MS || '300000', 10)
const CLEAR_BEFORE = process.env.MEILI_REINDEX_CLEAR === 'true'

async function waitForTask(
  client: MeiliSearch,
  taskUid: number,
  maxWaitMs = 120_000
): Promise<{ status: string }> {
  let elapsed = 0
  const interval = 1000
  while (elapsed < maxWaitMs) {
    const result = await client.tasks.getTask(taskUid)
    if (result.status === 'succeeded' || result.status === 'failed') {
      return result
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
    elapsed += interval
  }
  throw new Error(`Task ${taskUid} timed out after ${maxWaitMs}ms`)
}

async function main() {
  if (!MEILI_MASTER_KEY) {
    console.error('[meili-v0-reindex] MEILI_MASTER_KEY is required.')
    process.exit(1)
  }

  console.log(`[meili-v0-reindex] Connecting to ${MEILI_HOST}`)
  const client = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY })
  const health = await client.health()
  console.log(`[meili-v0-reindex] Health: ${health.status}`)

  await client.createIndex(INDEX_NAME, { primaryKey: 'id' }).catch(() => {})
  const index = client.index(INDEX_NAME)

  console.log('[meili-v0-reindex] Updating index settings...')
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
  await waitForTask(client, settingsTask.taskUid, TASK_WAIT_MS)

  if (CLEAR_BEFORE) {
    console.log('[meili-v0-reindex] Clearing index...')
    const clearTask = await index.deleteAllDocuments()
    await waitForTask(client, clearTask.taskUid, TASK_WAIT_MS)
  }

  console.log('[meili-v0-reindex] Loading product documents from PostgreSQL (paginated)...')
  let indexed = 0
  let offset = 0
  let productPages = 0

  while (true) {
    const productDocs = await fetchV0MeiliProductDocumentsPage({
      offset,
      limit: PRODUCT_FETCH_BATCH
    })
    if (productDocs.length === 0) break
    productPages++

    for (let i = 0; i < productDocs.length; i += BATCH_SIZE) {
      const batch = productDocs.slice(i, i + BATCH_SIZE)
      const task = await index.addDocuments(batch)
      await waitForTask(client, task.taskUid, TASK_WAIT_MS)
      indexed += batch.length
      console.log(`[meili-v0-reindex] Indexed ${indexed} product docs (page ${productPages})`)
    }

    offset += productDocs.length
    if (productDocs.length < PRODUCT_FETCH_BATCH) break
  }

  console.log('[meili-v0-reindex] Loading brand documents...')
  const brandDocs = await fetchV0MeiliBrandDocuments()
  for (let i = 0; i < brandDocs.length; i += BATCH_SIZE) {
    const batch = brandDocs.slice(i, i + BATCH_SIZE)
    const task = await index.addDocuments(batch)
    await waitForTask(client, task.taskUid, TASK_WAIT_MS)
    indexed += batch.length
  }
  console.log(`[meili-v0-reindex] Indexed ${indexed} total (${brandDocs.length} brands)`)

  const stats = await index.getStats()
  console.log('[meili-v0-reindex] Complete.', {
    indexed,
    numberOfDocuments: stats.numberOfDocuments
  })
}

main().catch((error) => {
  console.error('[meili-v0-reindex] Fatal:', error)
  process.exit(1)
})
