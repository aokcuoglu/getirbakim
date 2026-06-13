import { NextRequest } from 'next/server'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { getOrdersForUser } from '@/lib/orders/service'
import { getServerSession } from '@/lib/auth/server'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:account:orders',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const session = await getServerSession()

    if (!session?.user?.id) {
      return errorResponse({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
        context
      })
    }

    const orders = await getOrdersForUser(session.user.id)
    return successResponse({ orders }, context)
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'ACCOUNT_ORDERS_FAILED',
      message:
        error instanceof Error ? error.message : 'Orders could not be loaded.',
      context
    })
  }
}
