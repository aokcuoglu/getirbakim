import { NextRequest } from 'next/server'
import {
  errorResponse,
  successResponse,
  unexpectedErrorResponse
} from '@/lib/api/route-utils'
import { getPartnerProductById } from '@/lib/partner/catalog-query'
import { resolvePartnerDiscountBps, PARTNER_DISCOUNT_ENV } from '@/lib/partner/b2b-pricing'
import { toPartnerProductDto } from '@/lib/partner/dto'
import { partnerGuard } from '@/lib/partner/guard'
import { parsePartnerVehicleTypeId } from '@/lib/partner/input'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Partner ürün detayı — `GET /api/partner/v1/products/:id` (BAK-183).
 *
 * `:id` kanonik `catalog.products.id` değeridir; arama ucunun döndürdüğü `id`
 * doğrudan buraya verilir. Yayında olmayan ürün 404'tür (varlığı sızdırılmaz).
 */
export async function GET(
  request: NextRequest,
  contextArg: { params: Promise<{ id: string }> }
) {
  const guard = partnerGuard(request, 'api:partner:products:detail')
  if (!('partner' in guard)) return guard
  const { context } = guard

  try {
    const { id } = await contextArg.params
    if (!/^\d+$/.test(id)) {
      return errorResponse({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid product id.',
        context
      })
    }

    const parsedVehicleTypeId = parsePartnerVehicleTypeId(request.nextUrl.searchParams.get('vehicleTypeId'))
    if (!parsedVehicleTypeId.valid) {
      return errorResponse({ status: 400, code: 'VALIDATION_ERROR', message: 'Invalid vehicleTypeId.', context })
    }
    const vehicleTypeId = parsedVehicleTypeId.value

    const row = await getPartnerProductById(BigInt(id), vehicleTypeId)
    if (!row) {
      return errorResponse({
        status: 404,
        code: 'NOT_FOUND',
        message: 'Product not found.',
        context
      })
    }

    const discountBps = resolvePartnerDiscountBps(process.env[PARTNER_DISCOUNT_ENV])
    return successResponse({ product: toPartnerProductDto(row, { discountBps, vehicleTypeId }) }, context)
  } catch (error) {
    console.error('[partner/v1/products/:id]', error instanceof Error ? error.message : error)
    return unexpectedErrorResponse(error, context, 'Partner product lookup failed.')
  }
}
