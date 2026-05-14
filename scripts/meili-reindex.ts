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
 *   MEILI_REINDEX_INCLUDE_FITMENT=false               — include vehicle fitment data (default: false)
 *   MEILI_REINDEX_FITMENT_BATCH_SIZE=100              — fitment enrichment batch size (default: 100)
 *   MEILI_REINDEX_FITMENT_LIMIT_PER_PART=50           — max fitment entries per part (default: 50)
 *   MEILI_REINDEX_FITMENT_TIMEOUT_SAFE=true           — continue on fitment batch failures (default: true)
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
import { db } from '../lib/db'
import { Prisma } from '@prisma/client'

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || ''
const INDEX_NAME = process.env.MEILI_INDEX_PRODUCTS || 'products'
const BATCH_SIZE = parseInt(process.env.MEILI_REINDEX_BATCH_SIZE || '500', 10)
const CLEAR_BEFORE = process.env.MEILI_REINDEX_CLEAR === 'true'
const MAX_PARTS = parseInt(process.env.MEILI_REINDEX_MAX_PARTS || '0', 10) || undefined
const MAX_ORPHANS = parseInt(process.env.MEILI_REINDEX_MAX_ORPHAN_SUPPLIERS || '0', 10) || undefined
const INCLUDE_FITMENT = process.env.MEILI_REINDEX_INCLUDE_FITMENT !== 'false'
const FITMENT_BATCH_SIZE = parseInt(process.env.MEILI_REINDEX_FITMENT_BATCH_SIZE || '100', 10)
const FITMENT_LIMIT_PER_PART = parseInt(process.env.MEILI_REINDEX_FITMENT_LIMIT_PER_PART || '50', 10)
const FITMENT_TIMEOUT_SAFE = process.env.MEILI_REINDEX_FITMENT_TIMEOUT_SAFE !== 'false'

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

type FitmentRow = {
  part_id: bigint
  vehicle_brand_names: string[]
  vehicle_model_names: string[]
  vehicle_type_names: string[]
  vehicle_years: string[]
  engine_codes: string[]
  fitment_count: number
}

async function enrichWithFitment(
  documents: CanonicalSearchDocument[],
  batchSize: number,
  limitPerPart: number,
  timeoutSafe: boolean
): Promise<CanonicalSearchDocument[]> {
  const partIdDocs = documents.filter(d => d.partId && (d.documentType === 'canonical_part' || d.documentType === 'supplier_offer'))
  const partIds = partIdDocs.map(d => BigInt(d.partId!))

  if (partIds.length === 0) {
    console.log('[meili-reindex] No parts to enrich with fitment data')
    return documents
  }

  const fitmentMap = new Map<string, FitmentRow>()
  let batchesFailed = 0

  console.log(`[meili-reindex] Enriching ${partIds.length} parts with fitment data in batches of ${batchSize}...`)

  for (let i = 0; i < partIds.length; i += batchSize) {
    const batchIds = partIds.slice(i, i + batchSize)
    try {
      const rows = await db.$queryRaw<FitmentRow[]>(Prisma.sql`
        SELECT
          pvt.part_id,
          COALESCE(
            (SELECT JSONB_AGG(DISTINCT vb.name) FROM (
              SELECT DISTINCT vb2.name FROM part_vehicle_types pvt2
              JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
              JOIN vehicle_models vm2 ON vm2.id = vt2.model_id
              JOIN vehicle_brands vb2 ON vb2.id = vm2.brand_id
              WHERE pvt2.part_id = pvt.part_id
              LIMIT 20
            ) vb), '[]'::jsonb
          ) AS vehicle_brand_names,
          COALESCE(
            (SELECT JSONB_AGG(DISTINCT vm.name) FROM (
              SELECT DISTINCT vm2.name FROM part_vehicle_types pvt2
              JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
              JOIN vehicle_models vm2 ON vm2.id = vt2.model_id
              WHERE pvt2.part_id = pvt.part_id
              LIMIT 20
            ) vm), '[]'::jsonb
          ) AS vehicle_model_names,
          COALESCE(
            (SELECT JSONB_AGG(DISTINCT vt.name) FROM (
              SELECT DISTINCT vt2.name FROM part_vehicle_types pvt2
              JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
              WHERE pvt2.part_id = pvt.part_id
              LIMIT 20
            ) vt), '[]'::jsonb
          ) AS vehicle_type_names,
          COALESCE(
            (SELECT JSONB_AGG(DISTINCT vy.year) FROM (
              SELECT DISTINCT COALESCE(vt2.year_of_constr_from, vt2.year_of_constr_to) AS year
              FROM part_vehicle_types pvt2
              JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
              WHERE pvt2.part_id = pvt.part_id AND vt2.year_of_constr_from IS NOT NULL
              LIMIT 20
            ) vy), '[]'::jsonb
          ) AS vehicle_years,
          COALESCE(
            (SELECT JSONB_AGG(DISTINCT vtm.motor_type) FROM (
              SELECT DISTINCT vtm2.motor_type FROM part_vehicle_types pvt2
              JOIN vehicle_types vt2 ON vt2.id = pvt2.vehicle_type_id
              LEFT JOIN vehicle_type_modifications vtm2 ON vtm2.vehicle_type_id = vt2.id
              WHERE pvt2.part_id = pvt.part_id AND vtm2.motor_type IS NOT NULL
              LIMIT ${limitPerPart}
            ) vtm), '[]'::jsonb
          ) AS engine_codes,
          (SELECT COUNT(*) FROM part_vehicle_types pvt WHERE pvt.part_id = pvt.part_id) AS fitment_count
        FROM part_vehicle_types pvt
        WHERE pvt.part_id IN (${Prisma.join(batchIds)})
        GROUP BY pvt.part_id
      `)

      for (const row of rows) {
        fitmentMap.set(row.part_id.toString(), row)
      }

      console.log(`[meili-reindex] Fitment batch ${Math.floor(i / batchSize) + 1}: enriched ${rows.length} parts`)
    } catch (err) {
      batchesFailed++
      console.error(`[meili-reindex] Fitment batch ${Math.floor(i / batchSize) + 1} failed:`, err instanceof Error ? err.message : err)
      if (!timeoutSafe) {
        throw err
      }
    }
  }

  if (batchesFailed > 0) {
    console.warn(`[meili-reindex] ${batchesFailed} fitment batch(es) failed (continuing without fitment for those batches)`)
  }

  return documents.map(doc => {
    if (!doc.partId) return doc
    const fitment = fitmentMap.get(doc.partId)
    if (!fitment) return doc

    return {
      ...doc,
      vehicleBrandNames: Array.isArray(fitment.vehicle_brand_names) ? fitment.vehicle_brand_names.slice(0, 20) : [],
      vehicleModelNames: Array.isArray(fitment.vehicle_model_names) ? fitment.vehicle_model_names.slice(0, 20) : [],
      vehicleTypeNames: Array.isArray(fitment.vehicle_type_names) ? fitment.vehicle_type_names.slice(0, 20) : [],
      vehicleYears: Array.isArray(fitment.vehicle_years) ? fitment.vehicle_years.slice(0, 20) : [],
      engineCodes: Array.isArray(fitment.engine_codes) ? fitment.engine_codes.slice(0, limitPerPart) : [],
      fitmentCount: Number(fitment.fitment_count) || 0
    }
  })
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
  const includeFitment = INCLUDE_FITMENT
  console.log(`[meili-reindex] Phase 2: Building catalog-only documents (excluding ${supplierPartIds.size} supplier-mapped parts, fitment=${includeFitment})...`)
  const catalogLimit = MAX_PARTS ? Math.min(MAX_PARTS, 30000) : 30000
  const { documents: catalogDocs, total: catalogTotal } = await buildSearchDocumentsFromCatalog(
    supplierPartIds,
    catalogLimit
  )
  console.log(`[meili-reindex] Built ${catalogDocs.length} catalog-only documents (total in DB: ${catalogTotal})`)

  for (const doc of catalogDocs) {
    if (doc.availabilityStatus === 'PURCHASABLE') totalPurchasable++
    else if (doc.availabilityStatus === 'REQUEST_PRICE') totalRequestPrice++
    else if (doc.availabilityStatus === 'OUT_OF_STOCK') totalOutOfStock++
  }

  // Phase 2b: Fitment enrichment (batched, separate from main query)
  if (includeFitment) {
    console.log(`[meili-reindex] Phase 2b: Enriching supplier-backed + catalog documents with fitment data (batch_size=${FITMENT_BATCH_SIZE}, limit_per_part=${FITMENT_LIMIT_PER_PART}, timeout_safe=${FITMENT_TIMEOUT_SAFE})...`)
    const allDocsForFitment = [...supplierDocs, ...catalogDocs]
    const enrichedDocs = await enrichWithFitment(allDocsForFitment, FITMENT_BATCH_SIZE, FITMENT_LIMIT_PER_PART, FITMENT_TIMEOUT_SAFE)

    // Apply enrichment back to source arrays
    let idx = 0
    for (let i = 0; i < supplierDocs.length; i++) {
      supplierDocs[i] = enrichedDocs[idx++]
    }
    for (let i = 0; i < catalogDocs.length; i++) {
      catalogDocs[i] = enrichedDocs[idx++]
    }
    console.log(`[meili-reindex] Fitment enrichment complete for ${allDocsForFitment.length} documents`)
  } else {
    console.log(`[meili-reindex] Phase 2b: Fitment enrichment SKIPPED (MEILI_REINDEX_INCLUDE_FITMENT=false)`)
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
  console.log(`[meili-reindex] fitmentEnriched: ${includeFitment ? 'YES' : 'NO'}`)
  console.log(`[meili-reindex] totalDocuments: ${allDocs.length}`)
}

main().catch((error) => {
  console.error('[meili-reindex] Fatal error:', error)
  process.exit(1)
})