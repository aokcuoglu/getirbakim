import { NextRequest, NextResponse } from 'next/server'
import { dinamikFetch } from '@/lib/dinamik'
import { z } from 'zod'
import {
  attachStandardHeaders,
  errorResponse,
  parseJsonBody,
  withApiContext
} from '@/lib/api/route-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const stockRequestSchema = z.object({
  STOK_KODU: z.string().trim().min(1)
})

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:dinamik:stock',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const parsed = await parseJsonBody(request, stockRequestSchema, context)
    if (!parsed.success) return parsed.response

    const stockCode = parsed.data.STOK_KODU

    const res = await dinamikFetch('/api/Dnmk_Customer/getStock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ STOK_KODU: stockCode })
    })

    const payload = await res.text()

    return attachStandardHeaders(
      new NextResponse(payload, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') ?? 'application/json'
        }
      }),
      context
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Dinamik stock request failed'

    return errorResponse({
      status: 502,
      code: 'DINAMIK_STOCK_FAILED',
      message,
      context
    })
  }
}
