import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, requireAdmin, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { PartnerOrderError } from '@/lib/partner/order-contract'
import { PARTNER_OPERATOR_ACTIONS } from '@/lib/partner/operator-contract'
import { operatePartnerOrder } from '@/lib/partner/order-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const actionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  action: z.enum(PARTNER_OPERATOR_ACTIONS),
  reason: z.string().trim().max(500).nullable()
}).strict()

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, context, auth } = await requireAdmin(request, { keyPrefix: 'admin:partner-orders:act', limit: 60, windowMs: 60_000 })
  if (response) return response
  try {
    const { id } = await params
    if (!z.string().uuid().safeParse(id).success) return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid order id.', context })
    const parsed = actionSchema.safeParse(await request.json())
    if (!parsed.success) return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid operator action.', context })
    const order = await operatePartnerOrder({ id, actorId: auth.user.id, ...parsed.data })
    if (order.status === 'RESERVATION_EXPIRED') {
      return errorResponse({ status: 409, code: 'OFFER_EXPIRED', message: 'Talebin süresi doldu; kuyruk yenilendi.', context })
    }
    return successResponse({ order }, context)
  } catch (error) {
    if (error instanceof PartnerOrderError) {
      return errorResponse({ status: error.status, code: error.code, message: error.message, context })
    }
    console.error('[admin:partner-orders:act]', error)
    return unexpectedErrorResponse(error, context, 'Partner sipariş işlemi başarısız.')
  }
}
