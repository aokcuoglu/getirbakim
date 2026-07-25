import { NextRequest } from 'next/server'
import { getAdminAuth } from '@/lib/admin-auth'
import { errorResponse, successResponse, withApiContext } from '@/lib/api/route-utils'
import {
  createCanonicalProductFromSupplierRow,
  isProductListSupplier,
  parseSupplierProductId
} from '@/lib/admin/product-manual-match'
import { refreshSingleProductRollup } from '@/lib/catalog/refresh-product-rollups'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REASON_MESSAGES: Record<string, string> = {
  NOT_FOUND: 'Tedarikçi satırı bulunamadı ya da onaylı bir markaya bağlı değil.',
  ALREADY_LINKED: 'Bu tedarikçi satırı zaten bir offer’a bağlı.',
  KEY_CONFLICT:
    'Bu satırın hem part_no hem SKU numarası zaten kanonik bir üründe kayıtlı — yeni ürün açmak yerine mevcut ürünü düzenleyin.'
}

/**
 * Bağlanmamış bir tedarikçi satırından yeni kanonik ürün açar.
 *
 * Eşleşmeyen satırların çoğu, part_no anahtarını başka bir ham satırın kapmış
 * olması yüzünden takılıdır; gerçekten ayrı bir ürünse admin buradan kendi
 * kanonik kaydını açar ve detay sheet'inden zenginleştirebilir.
 */
export async function POST(request: NextRequest) {
  const auth = await getAdminAuth()
  const { context, limitedResponse } = withApiContext(request, {
    keyPrefix: 'eslestirme:products:manual:create',
    limit: 60,
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
    const body = await request.json().catch(() => ({}))

    if (!isProductListSupplier(body?.supplier)) {
      return errorResponse({
        status: 400,
        code: 'INVALID_SUPPLIER',
        message: 'Geçersiz tedarikçi.',
        context
      })
    }
    const supplierProductId = parseSupplierProductId(body?.supplierProductId)
    if (supplierProductId == null) {
      return errorResponse({
        status: 400,
        code: 'INVALID_ID',
        message: 'Geçerli bir supplierProductId gerekli.',
        context
      })
    }

    const result = await createCanonicalProductFromSupplierRow({
      supplier: body.supplier,
      supplierProductId,
      createdBy: auth.user.email ?? auth.user.id ?? null
    })

    if (!result.ok) {
      return errorResponse({
        status: result.reason === 'NOT_FOUND' ? 404 : 409,
        code: result.reason,
        message: REASON_MESSAGES[result.reason] ?? 'Kanonik ürün oluşturulamadı.',
        context
      })
    }

    // Fiyat/stok rollup'ı hemen hesaplansın; aksi halde ürün bir sonraki
    // sync'e kadar fiyatsız/stoksuz görünür.
    await refreshSingleProductRollup(BigInt(result.productId))

    return successResponse(
      {
        productId: result.productId,
        partNo: result.partNo,
        name: result.name,
        usedSkuKey: result.usedSkuKey,
        message: result.usedSkuKey
          ? `Yeni kanonik ürün açıldı (numara SKU’dan alındı: ${result.partNo}).`
          : 'Yeni kanonik ürün açıldı.'
      },
      context
    )
  } catch (error) {
    console.error('[eslestirme:products:manual:create] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Kanonik ürün oluşturulurken hata oluştu.',
      context
    })
  }
}
