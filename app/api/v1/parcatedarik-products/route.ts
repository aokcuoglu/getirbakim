import { NextRequest } from 'next/server'
import {
  errorResponse,
  successResponse,
  withApiContext
} from '@/lib/api/route-utils'
import { listV1ParcatedarikProducts } from '@/lib/v1/parcatedarik-sales'

export async function GET(request: NextRequest) {
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'api:v1:parcatedarik-products',
    limit: 120,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  try {
    const params = request.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page')) || 1)
    const limit = Math.min(60, Math.max(1, Number(params.get('limit')) || 24))
    const query = params.get('q')?.trim() || undefined
    const manufacturerIdRaw = Number(params.get('manufacturerId'))
    const manufacturerId =
      Number.isInteger(manufacturerIdRaw) && manufacturerIdRaw > 0
        ? manufacturerIdRaw
        : undefined

    const result = await listV1ParcatedarikProducts({
      page,
      limit,
      query,
      manufacturerId
    })

    return successResponse(result, context)
  } catch (error) {
    console.error('[api/v1/parcatedarik-products] failed:', error)
    return errorResponse({
      status: 500,
      code: 'V1_PARCA_CATALOG_FAILED',
      message: 'ParcaTedarik catalog could not be loaded.',
      context
    })
  }
}
