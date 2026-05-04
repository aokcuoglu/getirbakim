import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { getOrderForUser } from '@/lib/orders/service'

export async function GET(
  request: NextRequest,
  contextArg: { params: Promise<{ id: string }> }
) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:account:orders:detail',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const { id } = await contextArg.params
    const orderId = Number(id)
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid order id.',
        context
      })
    }

    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()

    if (!user?.id) {
      return errorResponse({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
        context
      })
    }

    const order = await getOrderForUser(user.id, orderId)
    if (!order) {
      return errorResponse({
        status: 404,
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found.',
        context
      })
    }

    return successResponse({ order }, context)
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'ACCOUNT_ORDER_DETAIL_FAILED',
      message:
        error instanceof Error ? error.message : 'Order detail could not be loaded.',
      context
    })
  }
}
