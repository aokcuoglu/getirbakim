import { NextRequest, NextResponse } from 'next/server'
import { getMeiliAdminClient } from '@/lib/search/meili-admin'
import { getProductsIndexName } from '@/lib/search/meilisearch-client'
import { buildAllCatalogSearchDocumentsPaginated } from '@/lib/search/search-document-builder'
import { configureMeilisearchIndex } from '@/lib/search/setup-index'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Full Meilisearch backfill from the `catalog` schema into the `products` index.
 * Every ACTIVE catalog product with a slug becomes one canonical document.
 * Idempotent (addDocuments upserts on primary key `id`). Bearer CRON_SECRET.
 * Pass ?fresh=1 to delete existing documents first (drops stale ids).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { success: false, message: 'CRON_SECRET not configured.' },
      { status: 500 }
    )
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
  }

  const fresh = request.nextUrl.searchParams.get('fresh') === '1'
  const batchSize = 1000
  const client = getMeiliAdminClient()
  const indexName = getProductsIndexName()
  let indexed = 0

  try {
    // Ensure searchable/filterable/sortable settings exist before indexing.
    await configureMeilisearchIndex()

    if (fresh) {
      await client.index(indexName).deleteAllDocuments()
    }

    const total = await buildAllCatalogSearchDocumentsPaginated(batchSize, async (docs) => {
      await client.index(indexName).addDocuments(docs)
      indexed += docs.length
      if (indexed % 25000 === 0) {
        console.info(`[search/index-catalog] indexed ${indexed} products...`)
      }
    })

    return NextResponse.json({ success: true, index: indexName, total, indexed })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        indexed,
        message: error instanceof Error ? error.message : 'Indexing failed.'
      },
      { status: 500 }
    )
  }
}
