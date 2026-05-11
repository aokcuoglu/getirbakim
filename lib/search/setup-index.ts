import 'server-only'
import { getMeiliAdminClient } from './meili-admin'
import { getProductsIndexName } from './meilisearch-client'

export async function configureMeilisearchIndex(): Promise<void> {
  const client = getMeiliAdminClient()
  const indexName = getProductsIndexName()

  await client.createIndex(indexName, { primaryKey: 'id' }).catch(() => {
    // Index may already exist — that's fine
  })

  const index = client.index(indexName)

  await index.updateSettings({
    searchableAttributes: [
      'title',
      'brand',
      'supplierSku',
      'oemCodes',
      'eanCodes',
      'normalizedSearchText',
      'categoryName',
      'name'
    ],
    filterableAttributes: [
      'availabilityStatus',
      'brand',
      'categorySlug',
      'providerName',
      'hasPrice',
      'hasStock',
      'sourceType',
      'brandId',
      'categoryId'
    ],
    sortableAttributes: [
      'price',
      'stockQty',
      'updatedAt',
      'rankScore'
    ],
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