import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { partnerGuard } from '@/lib/partner/guard'
import { PartnerOrderError } from '@/lib/partner/order-contract'
import { createPartnerOrder } from '@/lib/partner/order-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  selectedOfferId: z.string().min(1).max(64),
  quantity: z.number().int().positive().max(100),
  expectedUnitNetKurus: z.number().int().positive(),
  confirmationToken: z.string().min(1).max(4096)
}).strict()

export async function POST(request: NextRequest) {
  const guard = partnerGuard(request, 'api:partner:orders:create')
  if (!('partner' in guard)) return guard
  const { context, partner } = guard
  try {
    const idempotencyKey = request.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Valid Idempotency-Key header required.', context })
    }
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid partner order request.', context })
    }
    const result = await createPartnerOrder(partner.code, { idempotencyKey, ...parsed.data })
    return successResponse(result, context, { status: result.replayed ? 200 : 201 })
  } catch (error) {
    if (error instanceof PartnerOrderError) {
      return errorResponse({ status: error.status, code: error.code, message: error.message, details: error.details, context })
    }
    console.error('[partner/v1/orders]', error instanceof Error ? error.message : error)
    return unexpectedErrorResponse(error, context, 'Partner order creation failed.')
  }
}
