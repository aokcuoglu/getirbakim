import { apiRequest } from './client'
import { buildAdminProductsSearchParams } from '@/lib/admin-products-workbench'
import type {
  AdminProductDetail,
  AdminProductFilters,
  AdminProductOptions,
  AdminProductsWorkbenchResult
} from '@/lib/types/admin-products'

export function adminProductsWorkbenchQueryKey(
  filters: Required<AdminProductFilters>
) {
  return ['admin-products-workbench', filters] as const
}

export function adminProductDetailQueryKey(partId: string | null) {
  return ['admin-product-detail', partId] as const
}

export async function fetchAdminProductsWorkbench(
  filters: Required<AdminProductFilters>
): Promise<AdminProductsWorkbenchResult> {
  const params = buildAdminProductsSearchParams({ filters, productId: null })
  const query = params.toString()
  return apiRequest<AdminProductsWorkbenchResult>(
    `/api/admin/products/workbench${query ? `?${query}` : ''}`
  )
}

export async function fetchAdminProductDetail(
  partId: string
): Promise<AdminProductDetail> {
  return apiRequest<AdminProductDetail>(`/api/admin/products/${partId}/detail`)
}

export async function fetchAdminProductOptions(): Promise<AdminProductOptions> {
  return apiRequest<AdminProductOptions>('/api/admin/products/options')
}
