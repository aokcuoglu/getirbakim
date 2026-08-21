import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { partnerGuard } from '@/lib/partner/guard'
import { PartnerOrderError } from '@/lib/partner/order-contract'
import { quotePartnerOffer } from '@/lib/partner/order-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  selectedOfferId: z.string().min(1).max(64),
  quantity: z.number().int().positive().max(100)
}).strict()

export async function POST(request: NextRequest) {
  const guard = partnerGuard(request, 'api:partner:order-quotes:create')
  if (!('partner' in guard)) return guard
  const { context } = guard
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid quote request.', context })
    return successResponse({ quote: await quotePartnerOffer(parsed.data.selectedOfferId, parsed.data.quantity) }, context)
  } catch (error) {
    if (error instanceof PartnerOrderError) {
      return errorResponse({ status: error.status, code: error.code, message: error.message, details: error.details, context })
    }
    console.error('[partner/v1/order-quotes]', error instanceof Error ? error.message : error)
    return unexpectedErrorResponse(error, context, 'Partner quote failed.')
  }
}
