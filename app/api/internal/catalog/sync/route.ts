import { NextRequest, NextResponse } from 'next/server'
import { runCatalogSyncPipeline } from '@/lib/catalog/sync-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Catalog sync (steps 2–5): match raw supplier rows into catalog.products,
 * refresh offer price/stock, ingest OEM/EAN codes, refresh rollups.
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
    return NextResponse.json({ success: true, ...result })
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
