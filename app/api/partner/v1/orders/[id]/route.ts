import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { partnerGuard } from '@/lib/partner/guard'
import { PartnerOrderError } from '@/lib/partner/order-contract'
import { cancelPartnerOrder, getPartnerOrder } from '@/lib/partner/order-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function run(request: NextRequest, id: string, action: 'read' | 'cancel') {
  const guard = partnerGuard(request, `api:partner:orders:${action}`)
  if (!('partner' in guard)) return guard
  const { context, partner } = guard
  try {
    if (!z.string().uuid().safeParse(id).success) {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid order id.', context })
    }
    const order = action === 'read'
      ? await getPartnerOrder(partner.code, id)
      : await cancelPartnerOrder(partner.code, id)
    return successResponse({ order }, context)
  } catch (error) {
    if (error instanceof PartnerOrderError) {
      return errorResponse({ status: error.status, code: error.code, message: error.message, details: error.details, context })
    }
    console.error(`[partner/v1/orders/:id:${action}]`, error instanceof Error ? error.message : error)
    return unexpectedErrorResponse(error, context, 'Partner order operation failed.')
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return run(request, (await params).id, 'read')
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return run(request, (await params).id, 'cancel')
}
