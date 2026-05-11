/**
 * Meilisearch Index Setup Script
 *
 * Creates/updates the products index with searchable, filterable, and sortable attributes.
 * Configures synonyms for Turkish/English bilingual search.
 * Safe to rerun. Does NOT touch documents.
 *
 * Usage:
 *   bun run search:setup
 *   docker compose -f docker-compose.local.yml exec app bun run search:setup
 */

import { MeiliSearch } from 'meilisearch'
import { getMeiliSynonyms } from '../lib/search/search-synonyms'

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || ''
const INDEX_NAME = process.env.MEILI_INDEX_PRODUCTS || 'products'

async function main() {
  if (!MEILI_MASTER_KEY) {
    console.error('[meili-setup] MEILI_MASTER_KEY is required. Set it in .env or pass as environment variable.')
    process.exit(1)
  }

  console.log(`[meili-setup] Connecting to Meilisearch at ${MEILI_HOST}`)
  const client = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY })

  const health = await client.health()
  console.log(`[meili-setup] Meilisearch health: ${health.status}`)

  console.log(`[meili-setup] Creating/updating index "${INDEX_NAME}" with primary key "id"`)
  const task = await client.createIndex(INDEX_NAME, { primaryKey: 'id' })
  console.log(`[meili-setup] Create index task: ${task.taskUid}`)

  const index = client.index(INDEX_NAME)

  console.log('[meili-setup] Configuring searchable attributes...')
  const searchableTask = await index.updateSearchableAttributes([
    'title',
    'titleTr',
    'brand',
    'categoryName',
    'categoryNameTr',
    'supplierSku',
    'oemCodes',
    'eanCodes',
    'crossReferences',
    'referenceNumbers',
    'normalizedSearchText',
    'searchKeywords',
    'synonymsText',
    'vehicleBrandNames',
    'vehicleModelNames',
    'vehicleTypeNames',
    'engineCodes',
    'name'
  ])
  console.log(`[meili-setup] Searchable attributes task: ${searchableTask.taskUid}`)

  console.log('[meili-setup] Configuring filterable attributes...')
  const filterableTask = await index.updateFilterableAttributes([
    'documentType',
    'availabilityStatus',
    'brand',
    'categorySlug',
    'categoryId',
    'providerCode',
    'providerName',
    'hasPrice',
    'hasStock',
    'hasSupplierOffer',
    'matchStatus',
    'vehicleBrandNames',
    'vehicleModelNames',
    'brandId',
    'sourceType'
  ])
  console.log(`[meili-setup] Filterable attributes task: ${filterableTask.taskUid}`)

  console.log('[meili-setup] Configuring sortable attributes...')
  const sortableTask = await index.updateSortableAttributes([
    'rankScore',
    'price',
    'stockQty',
    'updatedAt',
    'offerCount',
    'fitmentCount'
  ])
  console.log(`[meili-setup] Sortable attributes task: ${sortableTask.taskUid}`)

  console.log('[meili-setup] Configuring ranking rules...')
  const rankingTask = await index.updateRankingRules([
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness'
  ])
  console.log(`[meili-setup] Ranking rules task: ${rankingTask.taskUid}`)

  console.log('[meili-setup] Configuring typo tolerance...')
  const typoTask = await index.updateTypoTolerance({
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 5,
      twoTypos: 9
    }
  })
  console.log(`[meili-setup] Typo tolerance task: ${typoTask.taskUid}`)

  console.log('[meili-setup] Configuring pagination...')
  const paginationTask = await index.updatePagination({
    maxTotalHits: 10000
  })
  console.log(`[meili-setup] Pagination task: ${paginationTask.taskUid}`)

  console.log('[meili-setup] Configuring synonyms...')
  const synonyms = getMeiliSynonyms()
  const synonymTask = await index.updateSynonyms(synonyms)
  console.log(`[meili-setup] Synonyms task: ${synonymTask.taskUid}`)

  console.log('[meili-setup] Waiting for all tasks to complete...')
  const taskUids = [
    task.taskUid,
    searchableTask.taskUid,
    filterableTask.taskUid,
    sortableTask.taskUid,
    rankingTask.taskUid,
    typoTask.taskUid,
    paginationTask.taskUid,
    synonymTask.taskUid
  ]

  for (const uid of taskUids) {
    let result: any
    let elapsed = 0
    const maxWait = 60_000
    const interval = 500
    while (elapsed < maxWait) {
      result = await client.tasks.getTask(uid)
      if (result.status === 'succeeded' || result.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, interval))
      elapsed += interval
    }
    if (!result) {
      console.error(`[meili-setup] Task ${uid} timed out`)
    } else if (result.status === 'failed') {
      console.error(`[meili-setup] Task ${uid} failed:`, result.error || 'unknown error')
    } else {
      console.log(`[meili-setup] Task ${uid}: ${result.status}`)
    }
  }

  console.log('[meili-setup] Setup complete.')
}

main().catch((error) => {
  console.error('[meili-setup] Fatal error:', error)
  process.exit(1)
})