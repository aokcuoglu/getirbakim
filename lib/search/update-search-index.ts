import 'server-only'
import { getMeiliAdminClient } from './meili-admin'
import { buildCatalogSearchDocumentsBatch } from './search-document-builder'
import { getProductsIndexName, isMeiliEnabled } from './meilisearch-client'

/**
 * Schedules an incremental Meilisearch update for the given catalog product IDs
 * (catalog.products.id). Meilisearch document updates are async on their side,
 * so this returns quickly. Call after catalog sync steps that affect known
 * product IDs. Documents are sourced from the `catalog` schema and pushed to
 * the canonical `products` index.
 */
export async function scheduleSearchIndexUpdate(productIds: bigint[]): Promise<void> {
  if (!isMeiliEnabled()) return
  if (productIds.length === 0) return

  try {
    const docs = await buildCatalogSearchDocumentsBatch(productIds)
    if (docs.length === 0) return

    const client = getMeiliAdminClient()
    await client.index(getProductsIndexName()).updateDocuments(docs)
  } catch (error) {
    // Non-critical: next full reindex will catch up
    console.warn(
      '[search] incremental update failed:',
      error instanceof Error ? error.message : error
    )
  }
}
