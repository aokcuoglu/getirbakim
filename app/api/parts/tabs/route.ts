import { NextRequest } from 'next/server'
import { getPartTabsDataById } from '@/lib/actions/getPartById'
import { z } from 'zod'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

const partTabsSchema = z
  .object({
    partId: z.coerce.number().int().positive()
  })
  .passthrough()

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:parts:tabs',
    limit: 180,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const start = performance.now()
    const parsed = await parseJsonBody(request, partTabsSchema, context)
    if (!parsed.success) return parsed.response

    const { partId } = parsed.data

    const data = await getPartTabsDataById(partId)
    if (!data) {
      return errorResponse({
        status: 404,
        code: 'PART_TABS_NOT_FOUND',
        message: 'Not found',
        context
      })
    }

    const res = successResponse({ data }, context)
    res.headers.set(
      'Server-Timing',
      `total;dur=${Number((performance.now() - start).toFixed(2))}`
    )
    return res
  } catch (error) {
    console.error('Error in /api/parts/tabs:', error)
    return errorResponse({
      status: 500,
      code: 'PART_TABS_FAILED',
      message: 'Server error',
      context
    })
  }
}
