import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isRedisAvailable } from '@/lib/redis'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  const version = process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown'
  const timings: Record<string, number> = {}

  try {
    const dbStart = Date.now()
    await db.$queryRaw`SELECT 1`
    timings.db = Date.now() - dbStart

    const redisStatus = isRedisAvailable() ? 'ok' : 'unavailable'

    return NextResponse.json({
      status: 'ok',
      version,
      checks: { database: 'ok', redis: redisStatus },
      runtimeMs: Date.now() - startedAt,
      timings,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        version,
        checks: { database: 'error' },
        runtimeMs: Date.now() - startedAt,
        timings,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    )
  }
}
