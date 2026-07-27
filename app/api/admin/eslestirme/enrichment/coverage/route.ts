import { NextRequest } from 'next/server'
import { requireAdmin, successResponse, unexpectedErrorResponse } from '@/lib/api/route-utils'
import { getCatalogEnrichmentCoverage } from '@/lib/admin/catalog-enrichment-stats'

/**
 * Zenginleştirme kapsam özeti.
 *
 * Server action değil route handler olmasının iki nedeni var: (1) Next, action
 * gövdesinde data cache'i no-store'a zorluyor, unstable_cache hiç tutmuyordu;
 * (2) action'lar istemcide kuyruğa alındığı için sekmedeki üç panel sırayla
 * bekliyordu. Düz GET'ler paralel gider.
 *
 * `?fresh=1` önbelleği atlar — "Yenile" düğmesi bunu kullanır.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:enrichment:coverage',
    limit: 60,
    windowMs: 60_000
  })
  if (response) return response

  try {
    const fresh = request.nextUrl.searchParams.get('fresh') === '1'
    return successResponse(await getCatalogEnrichmentCoverage({ fresh }), context)
  } catch (error) {
    console.error('[eslestirme:enrichment:coverage] Error:', error)
    return unexpectedErrorResponse(error, context, 'Kapsama verisi yüklenirken hata oluştu.')
  }
}
