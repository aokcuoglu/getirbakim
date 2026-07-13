import { NextRequest, NextResponse } from 'next/server'
import { getProductsIndexName } from '@/lib/search/meilisearch-client'
import { reindexCatalogSearch } from '@/lib/search/reindex-catalog'

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

  try {
    const { total, indexed } = await reindexCatalogSearch({
      fresh,
      onBatch: (count) => {
        if (count % 25000 === 0) {
          console.info(`[search/index-catalog] indexed ${count} products...`)
        }
      }
    })

    return NextResponse.json({
      success: true,
      index: getProductsIndexName(),
      total,
      indexed
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Indexing failed.'
      },
      { status: 500 }
    )
  }
}
