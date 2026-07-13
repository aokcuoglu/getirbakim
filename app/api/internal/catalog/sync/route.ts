import { NextRequest, NextResponse } from 'next/server'
import { runCatalogSyncPipeline } from '@/lib/catalog/sync-pipeline'
import { isMeiliEnabled } from '@/lib/search/meilisearch-client'
import { reindexCatalogSearch } from '@/lib/search/reindex-catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Catalog sync (steps 2-5): match raw supplier rows into catalog.products,
 * refresh offer price/stock, ingest OEM/EAN codes, refresh rollups, then refresh
 * the Meilisearch index so storefront search reflects the new price/stock.
 * Run after the supplier raw syncs (dinamik dnprd-sync, basbug catalog-seed).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json(
      { success: false, message: 'CRON_SECRET is not configured.' },
      { status: 500 }
    )
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, message: 'Unauthorized.' },
      { status: 401 }
    )
  }

  try {
    const result = await runCatalogSyncPipeline()

    // Keep storefront search fresh after the sync. Non-fatal: a reindex failure
    // must not fail the sync. Upsert (no fresh delete) to avoid an empty-search
    // window; run /api/internal/search/index-catalog?fresh=1 periodically to
    // prune products that left ACTIVE. NOTE: on a very large catalog this may
    // approach the 300s budget — prefer a separate reindex cron if that happens.
    let searchIndexed: number | null = null
    if (isMeiliEnabled()) {
      try {
        const reindex = await reindexCatalogSearch()
        searchIndexed = reindex.indexed
      } catch (error) {
        console.warn(
          '[catalog-sync] search reindex failed (non-critical):',
          error instanceof Error ? error.message : error
        )
      }
    }

    return NextResponse.json({ success: true, ...result, searchIndexed })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Catalog sync failed.'
      },
      { status: 500 }
    )
  }
}
