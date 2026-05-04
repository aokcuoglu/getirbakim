import 'server-only'
import { getMeiliAdminClient } from './meili-admin'
import { buildPartSearchDocumentsBatch } from './build-part-document'
import { PARTS_INDEX } from '@/lib/meilisearch'

/**
 * Schedules an incremental Meilisearch update for the given part IDs.
 * Meilisearch document updates are async on their side, so this returns quickly.
 * Call this after sync jobs that affect known part IDs.
 */
export async function scheduleSearchIndexUpdate(partIds: bigint[]): Promise<void> {
  if (process.env.MEILI_ENABLED !== 'true') return
  if (partIds.length === 0) return

  try {
    const docs = await buildPartSearchDocumentsBatch(partIds)
    if (docs.length === 0) return

    const client = getMeiliAdminClient()
    await client.index(PARTS_INDEX).updateDocuments(docs)
  } catch (error) {
    // Non-critical: next full sync will catch up
    console.warn('[search] incremental update failed:', error instanceof Error ? error.message : error)
  }
}
