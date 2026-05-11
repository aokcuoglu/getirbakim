import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isRedisAvailable } from '@/lib/redis'
import { isMeiliEnabled, checkMeiliHealth } from '@/lib/search/meilisearch-client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  const version = process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown'
  const timings: Record<string, number> = {}
  const checks: Record<string, string> = {}

  try {
    const dbStart = Date.now()
    await db.$queryRaw`SELECT 1`
    timings.db = Date.now() - dbStart
    checks.database = 'ok'
  } catch (error) {
    const dbStart = Date.now()
    checks.database = 'error'
    timings.db = Date.now() - dbStart
  }

  checks.redis = isRedisAvailable() ? 'ok' : 'unavailable'

  const meiliEnabled = isMeiliEnabled()
  if (meiliEnabled) {
    const meiliStart = Date.now()
    const meiliHealth = await checkMeiliHealth()
    timings.meili = Date.now() - meiliStart
    checks.meilisearch = meiliHealth.reachable ? `ok (${meiliHealth.status})` : `unreachable: ${meiliHealth.error}`
  } else {
    checks.meilisearch = 'disabled'
  }

  const indexingAllowed = process.env.NEXT_PUBLIC_ALLOW_INDEXING?.trim().toLowerCase() === 'true'
  checks.indexing = indexingAllowed ? 'allowed' : 'blocked'
  checks.siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'not-configured'

  const allOk = checks.database === 'ok'

  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'error',
      version,
      checks,
      runtimeMs: Date.now() - startedAt,
      timings,
      timestamp: new Date().toISOString()
    },
    { status: allOk ? 200 : 503 }
  )
}