import { NextRequest } from 'next/server'
import { errorResponse, requireAdmin, successResponse } from '@/lib/api/route-utils'
import {
  isSupplierKey,
  listSupplierBrandsForMatching,
  type SupplierBrandMatchStatus
} from '@/lib/admin/supplier-brand-match'

const VALID_STATUSES = ['all', 'matched', 'pending', 'unmatched'] as const

export async function GET(request: NextRequest) {
  const { response, context } = await requireAdmin(request, {
    keyPrefix: 'eslestirme:brands:list',
    limit: 100,
    windowMs: 60_000
  })
  if (response) return response

  const url = new URL(request.url)
  const supplier = url.searchParams.get('supplier') ?? 'dinamik'
  const status = url.searchParams.get('status') ?? 'all'
  const q = (url.searchParams.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)), 200)

  if (!isSupplierKey(supplier)) {
    return errorResponse({
      status: 400,
      code: 'INVALID_SUPPLIER',
      message: `Geçersiz tedarikçi: ${supplier}. İzin verilenler: dinamik, basbug`,
      context
    })
  }
  if (!VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return errorResponse({
      status: 400,
      code: 'INVALID_STATUS',
      message: `Geçersiz durum filtresi: ${status}`,
      context
    })
  }

  try {
    const data = await listSupplierBrandsForMatching({
      supplier,
      status: status as SupplierBrandMatchStatus,
      q,
      page,
      limit
    })
    return successResponse(data, context)
  } catch (error) {
    console.error('[eslestirme:brands:list] Error:', error)
    return errorResponse({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Marka eşleştirmeleri yüklenirken hata oluştu.',
      context
    })
  }
}
