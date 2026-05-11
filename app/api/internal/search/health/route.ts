import { NextRequest, NextResponse } from 'next/server'
import { isMeiliEnabled, checkMeiliHealth, getProductsIndexName } from '@/lib/search/meilisearch-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ success: false, message: 'CRON_SECRET not configured.' }, { status: 500 })
  }

  const authorization = request.headers.get('authorization')
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: 'Unauthorized.' }, { status: 401 })
  }

  const meiliEnabled = isMeiliEnabled()
  const indexName = getProductsIndexName()

  if (!meiliEnabled) {
    return NextResponse.json({
      meiliEnabled: false,
      meiliReachable: false,
      indexName,
      documentCount: 0
    })
  }

  const health = await checkMeiliHealth()

  let documentCount = 0
  if (health.reachable) {
    try {
      const { MeiliSearch } = await import('meilisearch')
      const { getMeiliHost } = await import('@/lib/search/meilisearch-client')
      const client = new MeiliSearch({
        host: getMeiliHost(),
        apiKey: process.env.MEILI_MASTER_KEY || ''
      })
      const index = client.index(indexName)
      const stats = await index.getStats()
      documentCount = stats.numberOfDocuments
    } catch {
      // Stats retrieval failed, report what we can
    }
  }

  return NextResponse.json({
    meiliEnabled,
    meiliReachable: health.reachable,
    meiliStatus: health.status,
    indexName,
    documentCount
  })
}