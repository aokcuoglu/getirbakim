import { NextRequest } from 'next/server'
import { getCatalogArticles } from '@/lib/actions/getCatalogArticles'
import { z } from 'zod'
import {
  errorResponse,
  parseJsonBody,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'

const catalogArticlesSchema = z
  .object({
    categoryName: z.string().optional(),
    searchIds: z.array(z.number().int().positive()).optional(),
    vehicleId: z.number().int().nullable().optional(),
    brands: z.array(z.string()).optional(),
    stockStatuses: z
      .array(z.enum(['in-stock', 'on-order']))
      .optional(),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
    sort: z.enum(['popularity', 'price-asc', 'price-desc', 'name']).optional(),
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
    includePrice: z.boolean().optional(),
    includeHits: z.boolean().optional(),
    includeTotal: z.boolean().optional(),
    includeFacets: z.boolean().optional()
  })
  .passthrough()

export async function POST(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:catalog:articles',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const parsed = await parseJsonBody(request, catalogArticlesSchema, context)
    if (!parsed.success) return parsed.response

    const payload = parsed.data
    const result = await getCatalogArticles(payload)

    const res = successResponse(result, context)

    // Set cache headers appropriately
    if (result.cached) {
      res.headers.set('X-Cache', 'HIT')
    } else {
      res.headers.set('X-Cache', 'MISS')
    }

    // Set Server-Timing headers if we have debug metrics
    if (result.debugTimingsMs) {
      const { debugTimingsMs } = result
      const timingParts = Object.entries(debugTimingsMs)
        .filter(([key]) => key !== 'total')
        .map(([key, val]) => `${key};dur=${val}`)

      if (debugTimingsMs.total) {
        timingParts.push(`total;dur=${debugTimingsMs.total}`)
      }

      if (timingParts.length > 0) {
        res.headers.set('Server-Timing', timingParts.join(','))
      }
    }

    return res
  } catch (error) {
    return errorResponse({
      status: 500,
      code: 'CATALOG_ARTICLES_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'Catalog article search failed',
      context
    })
  }
}
