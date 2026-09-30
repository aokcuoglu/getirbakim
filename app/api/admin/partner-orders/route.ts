import { NextRequest } from 'next/server'
import { requireAdmin, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { listPartnerOrdersForOperator } from '@/lib/partner/order-service'
import { getPartnerOrderOperationsStats } from '@/lib/partner/webhook-dispatcher'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, { keyPrefix: 'admin:partner-orders', limit: 60, windowMs: 60_000 })
  if (response) return response
  try {
    const [queue, stats] = await Promise.all([listPartnerOrdersForOperator(), getPartnerOrderOperationsStats()])
    return successResponse({ ...queue, stats }, context)
  } catch (error) {
    console.error('[admin:partner-orders]', error)
    return unexpectedErrorResponse(error, context, 'Partner sipariş kuyruğu yüklenemedi.')
  }
}
