import { NextRequest } from 'next/server'
import { errorResponse, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { partnerGuard } from '@/lib/partner/guard'
import { PartnerOrderError } from '@/lib/partner/order-contract'
import { getPartnerOrderByIdempotencyKey } from '@/lib/partner/order-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const guard = partnerGuard(request, 'api:partner:orders:by-key', 'orders')
  if (!('partner' in guard)) return guard
  const { context, partner } = guard
  try {
    const { key } = await params
    if (!key.trim() || key.length > 128) {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid idempotency key.', context })
    }
    const order = await getPartnerOrderByIdempotencyKey(partner.code, key.trim())
    return successResponse({ order }, context)
  } catch (error) {
    if (error instanceof PartnerOrderError) {
      return errorResponse({ status: error.status, code: error.code, message: error.message, context })
    }
    console.error('[partner/v1/orders/by-key]', error instanceof Error ? error.message : error)
    return unexpectedErrorResponse(error, context, 'Partner order lookup failed.')
  }
}
