import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:health',
    limit: 300,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  const startedAt = Date.now()

  try {
    // SQL is intentional here: this is the cheapest round-trip liveness probe.
    await db.$queryRaw`SELECT 1`

    return successResponse(
      {
        status: 'ok',
        checks: {
          database: 'ok'
        },
        runtimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      },
      context
    )
  } catch (error) {
    return errorResponse({
      status: 503,
      code: 'HEALTHCHECK_FAILED',
      message: error instanceof Error ? error.message : 'Unknown error',
      context,
      details: {
        status: 'error',
        checks: { database: 'error' },
        runtimeMs: Date.now() - startedAt,
        timestamp: new Date().toISOString()
      }
    })
  }
}
