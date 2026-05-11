/**
 * Meilisearch Reindex Script
 *
 * Reindexes products from PostgreSQL into Meilisearch.
 * Batches documents to avoid memory issues.
 *
 * Index order:
 * 1. Canonical parts (with supplier offer enrichment)
 * 2. Catalog-only parts (without supplier offers)
 * 3. Orphan supplier products (unmatched)
 *
 * Options:
 *   MEILI_REINDEX_CLEAR=true                         — delete all documents before reindexing
 *   MEILI_REINDEX_BATCH_SIZE=500                      — batch size (default: 500)
 *   MEILI_REINDEX_MAX_PARTS=0                        — max canonical part documents (0 = unlimited)
 *   MEILI_REINDEX_MAX_ORPHAN_SUPPLIERS=0              — max orphan supplier documents (0 = unlimited)
 *   MEILI_REINDEX_INCLUDE_FITMENT=true               — include vehicle fitment data (default: true)
 *   MEILI_REINDEX_FITMENT_LIMIT_PER_PART=50           — max fitment entries per part (default: 50)
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
  buildSearchDocumentsFromCatalog,
  buildOrphanSupplierDocuments
} from '../lib/search/search-document-builder'
import type { CanonicalSearchDocument } from '../lib/search/search-document-types'

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || ''
const INDEX_NAME = process.env.MEILI_INDEX_PRODUCTS || 'products'
const BATCH_SIZE = parseInt(process.env.MEILI_REINDEX_BATCH_SIZE || '500', 10)
const CLEAR_BEFORE = process.env.MEILI_REINDEX_CLEAR === 'true'
const MAX_PARTS = parseInt(process.env.MEILI_REINDEX_MAX_PARTS || '0', 10) || undefined
const MAX_ORPHANS = parseInt(process.env.MEILI_REINDEX_MAX_ORPHAN_SUPPLIERS || '0', 10) || undefined

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

async function indexInBatches(
  client: MeiliSearch,
  indexName: string,
  documents: CanonicalSearchDocument[],
  label: string
): Promise<number> {
  const index = client.index(indexName)
  let indexed = 0
  const batches: CanonicalSearchDocument[][] = []
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    batches.push(documents.slice(i, i + BATCH_SIZE))
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    console.log(`[meili-reindex] [${label}] Indexing batch ${i + 1}/${batches.length} (${batch.length} documents)...`)
    const task = await index.addDocuments(batch as any, { primaryKey: 'id' })
    const result = await waitForTask(client, INDEX_NAME, task.taskUid)
    if (result.status === 'failed') {
      console.error(`[meili-reindex] [${label}] Batch ${i + 1} failed:`, result.error)
    } else {
      indexed += batch.length
      console.log(`[meili-reindex] [${label}] Batch ${i + 1} complete. Total indexed: ${indexed}/${documents.length}`)
    }
  }

  return indexed
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

  let totalPurchasable = 0
  let totalRequestPrice = 0
  let totalOutOfStock = 0

  // Phase 1: Supplier-backed (mapped) documents
  const supplierLimit = MAX_PARTS || 50000
  console.log(`[meili-reindex] Phase 1: Building supplier-backed documents (limit: ${supplierLimit})...`)
  const { documents: supplierDocs, total: supplierTotal } = await buildSearchDocumentsFromSupplier(supplierLimit)
  console.log(`[meili-reindex] Built ${supplierDocs.length} supplier-backed documents (total in DB: ${supplierTotal})`)

  for (const doc of supplierDocs) {
    if (doc.availabilityStatus === 'PURCHASABLE') totalPurchasable++
    else if (doc.availabilityStatus === 'REQUEST_PRICE') totalRequestPrice++
    else if (doc.availabilityStatus === 'OUT_OF_STOCK') totalOutOfStock++
  }

  // Phase 2: Catalog-only documents (parts without supplier mapping)
  const supplierPartIds = new Set(
    supplierDocs
      .map((d) => d.partId)
      .filter((id): id is string => id !== null)
  )
  const includeFitment = process.env.MEILI_REINDEX_INCLUDE_FITMENT !== 'false'
  console.log(`[meili-reindex] Phase 2: Building catalog-only documents (excluding ${supplierPartIds.size} supplier-mapped parts, fitment=${includeFitment})...`)
  const catalogLimit = MAX_PARTS ? Math.min(MAX_PARTS, 30000) : 30000
  const { documents: catalogDocs, total: catalogTotal } = await buildSearchDocumentsFromCatalog(
    supplierPartIds,
    catalogLimit,
    { includeFitment }
  )
  console.log(`[meili-reindex] Built ${catalogDocs.length} catalog-only documents (total in DB: ${catalogTotal})`)

  for (const doc of catalogDocs) {
    if (doc.availabilityStatus === 'PURCHASABLE') totalPurchasable++
    else if (doc.availabilityStatus === 'REQUEST_PRICE') totalRequestPrice++
    else if (doc.availabilityStatus === 'OUT_OF_STOCK') totalOutOfStock++
  }

  // Phase 3: Orphan supplier products (unmatched)
  const orphanLimit = MAX_ORPHANS || 10000
  console.log(`[meili-reindex] Phase 3: Building orphan supplier product documents (limit: ${orphanLimit})...`)
  const { documents: orphanDocs, total: orphanTotal } = await buildOrphanSupplierDocuments(orphanLimit)
  console.log(`[meili-reindex] Built ${orphanDocs.length} orphan supplier documents (total in DB: ${orphanTotal})`)

  for (const doc of orphanDocs) {
    if (doc.availabilityStatus === 'PURCHASABLE') totalPurchasable++
    else if (doc.availabilityStatus === 'REQUEST_PRICE') totalRequestPrice++
    else if (doc.availabilityStatus === 'OUT_OF_STOCK') totalOutOfStock++
  }

  // Index all documents
  const allDocs = [...supplierDocs, ...catalogDocs, ...orphanDocs]
  console.log(`[meili-reindex] Total documents to index: ${allDocs.length}`)

  let totalIndexed = 0

  // Phase 1 indexing
  totalIndexed += await indexInBatches(client, INDEX_NAME, supplierDocs, 'supplier-backed')
  // Phase 2 indexing
  totalIndexed += await indexInBatches(client, INDEX_NAME, catalogDocs, 'catalog-only')
  // Phase 3 indexing
  totalIndexed += await indexInBatches(client, INDEX_NAME, orphanDocs, 'orphan-supplier')

  console.log(`[meili-reindex] Reindex complete. ${totalIndexed} documents indexed.`)

  const stats = await index.getStats()
  console.log(`[meili-reindex] Index stats: ${stats.numberOfDocuments} documents`)

  console.log('\n[meili-reindex] === Summary ===')
  console.log(`[meili-reindex] canonicalPartDocuments: ${supplierDocs.length + catalogDocs.length}`)
  console.log(`[meili-reindex] orphanSupplierDocuments: ${orphanDocs.length}`)
  console.log(`[meili-reindex] purchasableCount: ${totalPurchasable}`)
  console.log(`[meili-reindex] requestPriceCount: ${totalRequestPrice}`)
  console.log(`[meili-reindex] outOfStockCount: ${totalOutOfStock}`)
  console.log(`[meili-reindex] mappedSupplierProducts: ${supplierDocs.length}`)
  console.log(`[meili-reindex] unmappedSupplierProducts: ${orphanDocs.length}`)
  console.log(`[meili-reindex] totalDocuments: ${allDocs.length}`)
}

main().catch((error) => {
  console.error('[meili-reindex] Fatal error:', error)
  process.exit(1)
})