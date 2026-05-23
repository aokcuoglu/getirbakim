import 'server-only'
import { getMeiliAdminClient } from './meili-admin'
import { getProductsIndexName } from './meilisearch-client'
import { getMeiliSynonyms } from './search-synonyms'

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
      'titleTr',
      'brand',
      'brandName',
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
    ],
    filterableAttributes: [
      'documentType',
      'availabilityStatus',
      'brand',
      'brandName',
      'categoryName',
      'categoryNameTr',
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
    ],
    sortableAttributes: [
      'rankScore',
      'price',
      'stockQty',
      'updatedAt',
      'offerCount',
      'fitmentCount'
    ],
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: {
        oneTypo: 3,
        twoTypos: 6
      }
    },
    pagination: {
      maxTotalHits: 200000
    }
  })

  const synonyms = getMeiliSynonyms()
  await index.updateSynonyms(synonyms).catch(() => {
    // Synonyms update may not be supported in all Meili versions
  })
}