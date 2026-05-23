/**
 * Debug Meilisearch Category Filter
 *
 * Diagnoses whether categorySlug/categoryId are present in the Meilisearch
 * products index and whether category filtering works correctly.
 *
 * Usage:
 *   CATEGORY_SLUG=air-filter bun run scripts/debug-meili-category.ts
 *   docker compose -f docker-compose.local.yml exec app bun run scripts/debug-meili-category.ts
 */

import 'dotenv/config'
import { MeiliSearch } from 'meilisearch'

const MEILI_HOST = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY || ''
const INDEX_NAME = process.env.MEILI_INDEX_PRODUCTS || 'products'
const CATEGORY_SLUG = process.env.CATEGORY_SLUG || 'air-filter'

async function main() {
  if (!MEILI_MASTER_KEY) {
    console.error('[debug-meili-category] MEILI_MASTER_KEY is required.')
    process.exit(1)
  }

  const client = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY })

  try {
    const health = await client.health()
    console.log(`[debug-meili-category] Meilisearch health: ${health.status}`)
  } catch {
    console.error('[debug-meili-category] Cannot connect to Meilisearch')
    process.exit(1)
  }

  const index = client.index(INDEX_NAME)

  try {
    const stats = await index.getStats()
    console.log(`[debug-meili-category] Index "${INDEX_NAME}" has ${stats.numberOfDocuments} documents`)
  } catch {
    console.error(`[debug-meili-category] Index "${INDEX_NAME}" not found or inaccessible`)
    process.exit(1)
  }

  try {
    const settings = await index.getSettings()
    console.log(`[debug-meili-category] Filterable attributes: ${JSON.stringify(settings.filterableAttributes)}`)
    console.log(`[debug-meili-category] Sortable attributes: ${JSON.stringify(settings.sortableAttributes)}`)

    const hasCategorySlug = (settings.filterableAttributes as string[]).includes('categorySlug')
    const hasCategoryId = (settings.filterableAttributes as string[]).includes('categoryId')
    console.log(`[debug-meili-category] categorySlug filterable: ${hasCategorySlug}`)
    console.log(`[debug-meili-category] categoryId filterable: ${hasCategoryId}`)
  } catch (err) {
    console.error('[debug-meili-category] Failed to get settings:', err)
  }

  console.log(`\n[debug-meili-category] Testing category filter: categorySlug = "${CATEGORY_SLUG}"`)

  try {
    const results = await index.search('', {
      filter: `categorySlug = "${CATEGORY_SLUG}"`,
      limit: 5,
      attributesToRetrieve: ['id', 'name', 'categorySlug', 'categoryId', 'categoryName', 'documentType', 'availabilityStatus', 'hasPrice', 'hasStock', 'rankScore']
    })

    console.log(`[debug-meili-category] Total hits for "${CATEGORY_SLUG}": ${results.estimatedTotalHits ?? results.hits.length}`)
    console.log(`[debug-meili-category] Processing time: ${results.processingTimeMs}ms`)

    if (results.hits.length > 0) {
      console.log(`[debug-meili-category] Sample documents:`)
      for (const hit of results.hits) {
        const doc = hit as Record<string, unknown>
        console.log(`  id=${doc.id} name="${doc.name}" categorySlug=${doc.categorySlug} categoryId=${doc.categoryId} docType=${doc.documentType} avail=${doc.availabilityStatus} rankScore=${doc.rankScore}`)
      }
    } else {
      console.warn(`[debug-meili-category] No hits found for categorySlug="${CATEGORY_SLUG}". Documents may not have categorySlug field or reindex is needed.`)
    }
  } catch (err) {
    console.error(`[debug-meili-category] Filter test failed:`, err instanceof Error ? err.message : err)
  }

  console.log(`\n[debug-meili-category] Checking categorySlug distribution...`)
  try {
    const facetResults = await index.search('', {
      filter: `categorySlug = "${CATEGORY_SLUG}"`,
      limit: 0,
      facets: ['brand', 'availabilityStatus']
    })

    console.log(`[debug-meili-category] Brand facet distribution:`)
    if (facetResults.facetDistribution?.brand) {
      const sorted = Object.entries(facetResults.facetDistribution.brand as Record<string, number>)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
      for (const [brand, count] of sorted) {
        console.log(`  ${brand}: ${count}`)
      }
    }

    console.log(`[debug-meili-category] Availability facet distribution:`)
    if (facetResults.facetDistribution?.availabilityStatus) {
      for (const [status, count] of Object.entries(facetResults.facetDistribution.availabilityStatus as Record<string, number>)) {
        console.log(`  ${status}: ${count}`)
      }
    }
  } catch (err) {
    console.error(`[debug-meili-category] Facet distribution failed:`, err instanceof Error ? err.message : err)
  }

  console.log('\n[debug-meili-category] Done.')
}

main().catch((error) => {
  console.error('[debug-meili-category] Fatal error:', error)
  process.exit(1)
})