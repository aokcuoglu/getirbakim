import { NextRequest } from 'next/server'
import { getRelatedParts } from '@/lib/actions/getPartById'
import { z } from 'zod'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

const relatedPartsSchema = z
  .object({
    categoryId: z.coerce.number().int().positive(),
    excludePartId: z.coerce.number().int().positive(),
    limit: z.coerce.number().int().positive().max(12).optional()
  })
  .passthrough()

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:parts:related',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const start = performance.now()
    const parsed = await parseJsonBody(request, relatedPartsSchema, context)
    if (!parsed.success) return parsed.response

    const { categoryId, excludePartId } = parsed.data
    const safeLimit = parsed.data.limit ?? 6
    const parts = await getRelatedParts(categoryId, excludePartId, safeLimit)
    const res = successResponse({ parts }, context)
    res.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return res
  } catch (error) {
    console.error('Error in /api/parts/related:', error)
    return errorResponse({
      status: 500,
      code: 'RELATED_PARTS_FAILED',
      message: 'Server error',
      context
    })
  }
}
