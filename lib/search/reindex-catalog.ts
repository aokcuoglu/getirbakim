import 'server-only'
import { getMeiliAdminClient } from './meili-admin'
import { getProductsIndexName } from './meilisearch-client'
import { buildAllCatalogSearchDocumentsPaginated } from './search-document-builder'
import { configureMeilisearchIndex } from './setup-index'

export interface ReindexCatalogResult {
  total: number
  indexed: number
}

/**
 * Rebuild the Meilisearch `products` index from the catalog schema. Shared by
 * the manual /api/internal/search/index-catalog endpoint and the catalog sync
 * cron so storefront search stays fresh after every sync.
 *
 * fresh=true deletes existing documents first (prunes ids that left ACTIVE) at
 * the cost of a brief empty-search window. fresh=false (default) upserts, so
 * search stays fully available; docs for products that left ACTIVE linger until
 * the next fresh run.
 */
export async function reindexCatalogSearch(
  opts: {
    fresh?: boolean
    batchSize?: number
    onBatch?: (indexed: number) => void
  } = {}
): Promise<ReindexCatalogResult> {
  const { fresh = false, batchSize = 1000, onBatch } = opts
  const client = getMeiliAdminClient()
  const index = client.index(getProductsIndexName())

  // Ensure searchable/filterable/sortable settings exist before indexing.
  await configureMeilisearchIndex()
  if (fresh) {
    await index.deleteAllDocuments()
  }

  let indexed = 0
  const total = await buildAllCatalogSearchDocumentsPaginated(batchSize, async (docs) => {
    await index.addDocuments(docs)
    indexed += docs.length
    onBatch?.(indexed)
  })

  return { total, indexed }
}
