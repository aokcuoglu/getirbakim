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

  // The index almost always exists already. Calling createIndex anyway enqueues a
  // task that Meili completes with status 'failed' (index_already_exists), which
  // read as a broken setup in every rerun's output. Ask first, create only if missing.
  let createTaskUid: number | null = null
  const exists = await client
    .getIndex(INDEX_NAME)
    .then(() => true)
    .catch(() => false)
  if (exists) {
    console.log(`[meili-setup] Index "${INDEX_NAME}" already exists — skipping create.`)
  } else {
    console.log(`[meili-setup] Creating index "${INDEX_NAME}" with primary key "id"`)
    const task = await client.createIndex(INDEX_NAME, { primaryKey: 'id' })
    createTaskUid = task.taskUid
    console.log(`[meili-setup] Create index task: ${task.taskUid}`)
  }

  const index = client.index(INDEX_NAME)

  console.log('[meili-setup] Configuring searchable attributes...')
  const searchableTask = await index.updateSearchableAttributes([
    'title',
    'titleTr',
    'brand',
    'categoryName',
    'categoryNameTr',
    'supplierSku',
    'normalizedSku',
    'oemCodes',
    'eanCodes',
    'crossReferences',
    'referenceNumbers',
    'exactCodes',
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
    createTaskUid,
    searchableTask.taskUid,
    filterableTask.taskUid,
    sortableTask.taskUid,
    rankingTask.taskUid,
    typoTask.taskUid,
    paginationTask.taskUid,
    synonymTask.taskUid
  ].filter((uid): uid is number => uid !== null)

  // An attribute change rebuilds the whole index; on the ~1M document catalog that
  // runs for minutes, and the old 60s ceiling gave up on it every time. Meili would
  // still finish in the background, but the script reported 'processing' and moved
  // on — so a genuinely stuck task looked exactly like a slow one.
  const maxWait = 900_000
  let failed = 0

  for (const uid of taskUids) {
    let result: any
    let elapsed = 0
    const interval = 500
    while (elapsed < maxWait) {
      result = await client.tasks.getTask(uid)
      if (result.status === 'succeeded' || result.status === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, interval))
      elapsed += interval
    }
    if (!result || (result.status !== 'succeeded' && result.status !== 'failed')) {
      console.error(
        `[meili-setup] Task ${uid} still ${result?.status ?? 'unknown'} after ${maxWait / 1000}s — ` +
          'Meili keeps working on it, but do not trust search results until it settles.'
      )
    } else if (result.status === 'failed') {
      failed++
      console.error(`[meili-setup] Task ${uid} failed:`, result.error || 'unknown error')
    } else {
      console.log(`[meili-setup] Task ${uid}: ${result.status}`)
    }
  }

  // Exit non-zero so catalog-reindex.sh stops before the backfill: indexing a
  // million documents against a half-configured index only hides the problem.
  if (failed > 0) {
    console.error(`[meili-setup] ${failed} task(s) failed — index is not fully configured.`)
    process.exit(1)
  }

  console.log('[meili-setup] Setup complete.')
}

main().catch((error) => {
  console.error('[meili-setup] Fatal error:', error)
  process.exit(1)
})