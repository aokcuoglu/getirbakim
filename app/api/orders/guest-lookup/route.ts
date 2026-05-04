import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { lookupGuestOrder } from '@/lib/orders/service'

const bodySchema = z.object({
  orderNumber: z.string().min(1).max(32),
  email: z.string().email().max(320)
})

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:orders:guest-lookup',
    limit: 60,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const parsed = await parseJsonBody(request, bodySchema, context)
    if (!parsed.success) return parsed.response

    const order = await lookupGuestOrder(parsed.data.orderNumber, parsed.data.email)
    if (!order) {
      return errorResponse({
        status: 404,
        code: 'ORDER_NOT_FOUND',
        message: 'No order matched the provided order number and email.',
        context
      })
    }

    return successResponse({ order }, context)
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'GUEST_ORDER_LOOKUP_FAILED',
      message:
        error instanceof Error ? error.message : 'Guest order lookup failed.',
      context
    })
  }
}
