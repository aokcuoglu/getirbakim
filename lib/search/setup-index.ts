import 'server-only'
import { getMeiliAdminClient } from './meili-admin'
import { PARTS_INDEX } from '@/lib/meilisearch'

export async function configureMeilisearchIndex(): Promise<void> {
  const client = getMeiliAdminClient()

  // Ensure index exists
  await client.createIndex(PARTS_INDEX, { primaryKey: 'id' }).catch(() => {
    // Index may already exist — that's fine
  })

  const index = client.index(PARTS_INDEX)

  await index.updateSettings({
    searchableAttributes: [
      'articleLinkId',
      'oems',
      'eans',
      'crossRefCodes',
      'name',
      'brandName',
      'categoryName'
    ],
    filterableAttributes: ['brandId', 'categoryId', 'isVisible', 'hasStock'],
    sortableAttributes: ['price', 'updatedAt'],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: {
        oneTypo: 5,
        twoTypos: 9
      }
    },
    pagination: {
      maxTotalHits: 10000
    }
  })
}
