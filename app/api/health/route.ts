import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  const version = process.env.NEXT_PUBLIC_BUILD_VERSION || 'unknown'

  try {
    await db.$queryRaw`SELECT 1`

    return NextResponse.json({
      status: 'ok',
      version,
      checks: { database: 'ok' },
      runtimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        version,
        checks: { database: 'error' },
        runtimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    )
  }
}
