import { NextRequest } from 'next/server'
import { successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import {
  clampPartnerLimit,
  searchPartnerProducts,
  PARTNER_MIN_QUERY_LENGTH
} from '@/lib/partner/catalog-query'
import { resolvePartnerDiscountBps, PARTNER_DISCOUNT_ENV } from '@/lib/partner/b2b-pricing'
import { toPartnerProductDto } from '@/lib/partner/dto'
import { partnerGuard } from '@/lib/partner/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Partner katalog araması — `GET /api/partner/v1/products` (BAK-183).
 *
 * `?oem=` verilirse OEM koduyla tam eşleşme aranır (B2B'nin asıl yolu);
 * verilmezse `?q=` ile serbest metin araması yapılır. `?limit=` sunucuda
 * kırpılır.
 *
 * Yanıttaki fiyatlar KDV HARİÇ ve kuruştur: `listPriceKurus` vitrin fiyatı,
 * `b2bPriceKurus` partnerin ödeyeceği fiyat (bkz. lib/partner/b2b-pricing.ts).
 * `lastSyncedAt` sözleşmenin parçasıdır — bu uç ANLIK stok vaat etmez.
 */
export async function GET(request: NextRequest) {
  const guard = partnerGuard(request, 'api:partner:products:search')
  if (!('partner' in guard)) return guard
  const { context } = guard

  try {
    const params = request.nextUrl.searchParams
    const { rows, source } = await searchPartnerProducts({
      q: params.get('q'),
      oem: params.get('oem'),
      limit: clampPartnerLimit(params.get('limit'))
    })

    const discountBps = resolvePartnerDiscountBps(process.env[PARTNER_DISCOUNT_ENV])

    return successResponse(
      {
        products: rows.map((row) => toPartnerProductDto(row, { discountBps })),
        source,
        minQueryLength: PARTNER_MIN_QUERY_LENGTH
      },
      context
    )
  } catch (error) {
    console.error('[partner/v1/products]', error instanceof Error ? error.message : error)
    return unexpectedErrorResponse(error, context, 'Partner search failed.')
  }
}
