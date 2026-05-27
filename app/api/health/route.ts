import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

import { isMeiliEnabled, checkMeiliHealth } from '@/lib/search/meilisearch-client'

export const dynamic = 'force-dynamic'

const HEALTH_DB_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`health database check timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}


export async function GET() {
  const startedAt = Date.now()
  const version = process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown'
  const timings: Record<string, number> = {}
  const checks: Record<string, string> = {}

  const dbStart = Date.now()
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, HEALTH_DB_TIMEOUT_MS)
    checks.database = 'ok'
  } catch {
    checks.database = 'error'
  } finally {
    timings.db = Date.now() - dbStart
  }

  checks.redis = 'disabled'

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