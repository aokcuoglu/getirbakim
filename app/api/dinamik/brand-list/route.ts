import { NextRequest, NextResponse } from 'next/server'
import { dinamikFetch } from '@/lib/dinamik'
import {
  attachStandardHeaders,
  errorResponse,
  withApiContext
} from '@/lib/api/route-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:dinamik:brand-list',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const res = await dinamikFetch('/api/Dnmk_Customer/getBrandList')
    const body = await res.text()

    return attachStandardHeaders(
      new NextResponse(body, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'application/json'
        }
      }),
      context
    )
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Dinamik brand-list request failed'

    return errorResponse({
      status: 502,
      code: 'DINAMIK_BRAND_LIST_FAILED',
      message,
      context
    })
  }
}
