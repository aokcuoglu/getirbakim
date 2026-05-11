/**
 * Meilisearch Reindex Script
 *
 * Reindexes products from PostgreSQL into Meilisearch.
 * Batches documents to avoid memory issues.
 *
 * Options:
 *   MEILI_REINDEX_CLEAR=true   — delete all documents before reindexing
 *   MEILI_REINDEX_BATCH_SIZE    — batch size (default: 500)
 *   MEILI_REINDEX_LIMIT         — max documents to index per source
 *
 * Usage:
 *   bun run search:reindex
 *   MEILI_REINDEX_CLEAR=true bun run search:reindex
 *   docker compose -f docker-compose.local.yml exec app bun run search:reindex
 */

import 'dotenv/config'

import { MeiliSearch } from 'meilisearch'
import {
  buildSearchDocumentsFromSupplier,
  buildSearchDocumentsFromCatalog
} from '../lib/search/search-document-builder'

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || ''
const INDEX_NAME = process.env.MEILI_INDEX_PRODUCTS || 'products'
const BATCH_SIZE = parseInt(process.env.MEILI_REINDEX_BATCH_SIZE || '500', 10)
const CLEAR_BEFORE = process.env.MEILI_REINDEX_CLEAR === 'true'

async function waitForTask(client: MeiliSearch, indexName: string, taskUid: number, maxWaitMs: number = 120_000): Promise<any> {
  let elapsed = 0
  const interval = 1000
  while (elapsed < maxWaitMs) {
    const result = await client.tasks.getTask(taskUid)
    if (result.status === 'succeeded' || result.status === 'failed') return result
    await new Promise((resolve) => setTimeout(resolve, interval))
    elapsed += interval
  }
  throw new Error(`Task ${taskUid} timed out after ${maxWaitMs}ms`)
}

async function main() {
  if (!MEILI_MASTER_KEY) {
    console.error('[meili-reindex] MEILI_MASTER_KEY is required. Set it in .env or pass as environment variable.')
    process.exit(1)
  }

  console.log(`[meili-reindex] Connecting to Meilisearch at ${MEILI_HOST}`)
  const client = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY })

  const health = await client.health()
  console.log(`[meili-reindex] Meilisearch health: ${health.status}`)

  const index = client.index(INDEX_NAME)

  if (CLEAR_BEFORE) {
    console.log('[meili-reindex] Clearing all documents from index...')
    const deleteTask = await index.deleteAllDocuments()
    const result = await waitForTask(client, INDEX_NAME, deleteTask.taskUid, 120_000)
    console.log(`[meili-reindex] Delete task ${deleteTask.taskUid}: ${result.status}`)
  }

  console.log(`[meili-reindex] Building supplier-backed documents...`)
  const { documents: supplierDocs, total: supplierTotal } = await buildSearchDocumentsFromSupplier(50000)
  console.log(`[meili-reindex] Built ${supplierDocs.length} supplier-backed documents (total in DB: ${supplierTotal})`)

  console.log(`[meili-reindex] Building catalog-only documents...`)
  const supplierPartIds = new Set(
    supplierDocs.map((d) => d.partId).filter((id): id is string => id !== null)
  )
  const { documents: catalogDocs, total: catalogTotal } = await buildSearchDocumentsFromCatalog(
    supplierPartIds,
    30000
  )
  console.log(`[meili-reindex] Built ${catalogDocs.length} catalog-only documents (total in DB: ${catalogTotal})`)

  const allDocs = [...supplierDocs, ...catalogDocs]
  console.log(`[meili-reindex] Total documents to index: ${allDocs.length}`)

  let indexed = 0
  const batches: typeof allDocs[] = []
  for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
    batches.push(allDocs.slice(i, i + BATCH_SIZE))
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    console.log(`[meili-reindex] Indexing batch ${i + 1}/${batches.length} (${batch.length} documents)...`)
    const task = await index.addDocuments(batch, { primaryKey: 'id' })
    const result = await waitForTask(client, INDEX_NAME, task.taskUid)
    if (result.status === 'failed') {
      console.error(`[meili-reindex] Batch ${i + 1} failed:`, result.error)
    } else {
      indexed += batch.length
      console.log(`[meili-reindex] Batch ${i + 1} complete. Total indexed: ${indexed}/${allDocs.length}`)
    }
  }

  console.log(`[meili-reindex] Reindex complete. ${indexed} documents indexed.`)

  const stats = await index.getStats()
  console.log(`[meili-reindex] Index stats: ${stats.numberOfDocuments} documents`)
}

main().catch((error) => {
  console.error('[meili-reindex] Fatal error:', error)
  process.exit(1)
})