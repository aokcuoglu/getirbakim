import { apiRequest } from './client'
import type { AdminDpmatchFilterOptions } from '@/lib/admin/dpprd-filter-options'
import {
  buildDpmatchWorkbenchSearchParams,
  type AdminDpmatchWorkbenchFilters
} from '@/lib/admin/dpprd-workbench-url'
import type { AdminDpmatchListResult } from '@/lib/admin/dpprd-catalog'
import type { AdminDpmatchWorkbenchResult } from '@/lib/admin/dpprd-workbench-mapper'
import { mapDpmatchListToProductsResult } from '@/lib/admin/dpprd-workbench-mapper'

export function adminDpmatchWorkbenchQueryKey(
  filters: AdminDpmatchWorkbenchFilters
) {
  return ['admin-dpprd-workbench', filters] as const
}

export async function fetchDpmatchFilterOptions(): Promise<AdminDpmatchFilterOptions> {
  return apiRequest<AdminDpmatchFilterOptions>(
    '/api/admin/catalog/products/options'
  )
}

export async function fetchDpmatchWorkbench(
  filters: AdminDpmatchWorkbenchFilters,
  productId: string | null = null
): Promise<AdminDpmatchWorkbenchResult> {
  const params = buildDpmatchWorkbenchSearchParams({ filters, productId })
  const query = params.toString()
  const payload = await apiRequest<AdminDpmatchListResult>(
    `/api/admin/catalog/products${query ? `?${query}` : ''}`
  )
  return mapDpmatchListToProductsResult(payload)
}
