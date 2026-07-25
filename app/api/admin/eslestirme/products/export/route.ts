import { NextRequest, NextResponse } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import {
  isProductListCoverage,
  isProductListStatus,
  isProductListSupplier
} from '@/lib/admin/product-list'
import {
  buildExportFilename,
  countProductListExportRows,
  PRODUCT_CSV_EXPORT_MAX_ROWS,
  streamProductListCsv
} from '@/lib/admin/product-list-export'
import type { ProductListFilterInput } from '@/lib/admin/product-list-sql'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Ürün eşleştirme tablosunun CSV export'u — ekrandaki filtrelerin TAMAMI
 * (sayfalama olmadan) tek dosyaya akıtılır.
 */
export async function GET(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:export',
    // Her indirme iki istek yapıyor (önce countOnly, sonra dosya).
    limit: 20,
    windowMs: 60_000
  })
  if (limitedResponse) return limitedResponse

  if (!auth?.user) {
    return errorResponse({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      context
    })
  }
  if (auth.user.role !== 'ADMIN') {
    return errorResponse({
      status: 403,
      code: 'ADMIN_REQUIRED',
      message: 'Admin access required.',
      context
    })
  }

  try {
    const sp = request.nextUrl.searchParams
    const supplierRaw = sp.get('supplier') ?? 'dinamik'
    const statusRaw = sp.get('status') ?? 'all'
    const coverageRaw = sp.get('coverage') ?? 'all'
    const brandIdRaw = parseInt(sp.get('brandId') ?? '', 10)

    const input: ProductListFilterInput = {
      supplier: isProductListSupplier(supplierRaw) ? supplierRaw : 'dinamik',
      status: isProductListStatus(statusRaw) ? statusRaw : 'all',
      coverage: isProductListCoverage(coverageRaw) ? coverageRaw : 'all',
      q: sp.get('q') ?? undefined,
      brandId: Number.isNaN(brandIdRaw) ? undefined : brandIdRaw
    }

    // Sessizce kırpmak yerine reddet: kırpılmış bir dosya geri yüklendiğinde
    // "eksik satırlar" gerçek bir veri kaybı gibi görünürdü.
    const total = await countProductListExportRows(input)
    if (total > PRODUCT_CSV_EXPORT_MAX_ROWS) {
      return errorResponse({
        status: 413,
        code: 'EXPORT_TOO_LARGE',
        message: `Bu filtreyle ${total.toLocaleString('tr-TR')} satır var; tek dosyada en fazla ${PRODUCT_CSV_EXPORT_MAX_ROWS.toLocaleString('tr-TR')} satır indirilebilir. Marka veya durum filtresiyle daraltın.`,
        context
      })
    }

    // Sayım modu: istemci indirmeyi tarayıcıya (diske stream) bıraktığı için
    // hata/boyut kontrolünü önce bu ucuz çağrıyla yapar — yoksa yüzlerce MB'lık
    // yanıtı sırf hata var mı diye belleğe almak gerekirdi.
    if (sp.get('countOnly') === '1') {
      return successResponse({ total }, context)
    }

    const encoder = new TextEncoder()
    const iterator = streamProductListCsv(input)
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next()
          if (done) {
            controller.close()
            return
          }
          controller.enqueue(encoder.encode(value))
        } catch (error) {
          console.error('[eslestirme:products:export] Stream error:', error)
          controller.error(error)
        }
      }
    })

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${buildExportFilename(input, stamp)}"`,
        'Cache-Control': 'no-store',
        'X-Row-Count': String(total),
        'X-Request-Id': context.requestId
      }
    })
  } catch (error) {
    console.error('[eslestirme:products:export] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'CSV dışa aktarılırken hata oluştu.',
      context
    })
  }
}
