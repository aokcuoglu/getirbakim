import 'server-only'
import { getMeiliClient } from '@/lib/search/meilisearch-client'
import { getV0CatalogIndexName } from '@/lib/v0/search/v0-meilisearch-client'

export async function configureV0MeilisearchIndex(): Promise<void> {
  const client = getMeiliClient()
  const indexName = getV0CatalogIndexName()

  await client.createIndex(indexName, { primaryKey: 'id' }).catch(() => {})

  const index = client.index(indexName)
  await index.updateSettings({
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
      minWordSizeForTypos: {
        oneTypo: 4,
        twoTypos: 8
      }
    },
    pagination: {
      maxTotalHits: 50000
    }
  })
}
