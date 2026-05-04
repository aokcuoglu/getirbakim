import type { AdminProductFilters } from '@/lib/types/admin-products'

type SearchParamRecord = Record<string, string | string[] | undefined>

export interface AdminProductsUrlState {
  filters: Required<AdminProductFilters>
  productId: string | null
}

export const DEFAULT_ADMIN_PRODUCT_FILTERS: Required<AdminProductFilters> = {
  q: '',
  page: 1,
  limit: 20,
  brandId: null,
  categoryId: null,
  providerId: null,
  stockStatus: 'all',
  visibility: 'all',
  syncStatus: 'all',
  sortBy: 'created_at',
  sortOrder: 'desc'
}

function readParamValue(
  input: URLSearchParams | SearchParamRecord,
  key: string
): string | undefined {
  if (input instanceof URLSearchParams) {
    return input.get(key) ?? undefined
  }

  const value = input[key]
  if (Array.isArray(value)) return value[0]
  return value
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.trunc(parsed)
}

export function parseAdminProductsUrlState(
  input: URLSearchParams | SearchParamRecord
): AdminProductsUrlState {
  const page = parsePositiveInt(readParamValue(input, 'page'))
  const limit = parsePositiveInt(readParamValue(input, 'limit'))
  const brandId = parsePositiveInt(readParamValue(input, 'brand'))
  const categoryId = parsePositiveInt(readParamValue(input, 'category'))
  const providerId = parsePositiveInt(readParamValue(input, 'provider'))
  const productId = (readParamValue(input, 'productId') || '').trim() || null

  return {
    filters: {
      q: (readParamValue(input, 'q') || '').trim(),
      page: page ?? DEFAULT_ADMIN_PRODUCT_FILTERS.page,
      limit: limit ? Math.min(limit, 100) : DEFAULT_ADMIN_PRODUCT_FILTERS.limit,
      brandId,
      categoryId,
      providerId,
      stockStatus:
        (readParamValue(input, 'stockStatus') as
          | Required<AdminProductFilters>['stockStatus']
          | undefined) || DEFAULT_ADMIN_PRODUCT_FILTERS.stockStatus,
      visibility:
        (readParamValue(input, 'visibility') as
          | Required<AdminProductFilters>['visibility']
          | undefined) || DEFAULT_ADMIN_PRODUCT_FILTERS.visibility,
      syncStatus:
        (readParamValue(input, 'syncStatus') as
          | Required<AdminProductFilters>['syncStatus']
          | undefined) || DEFAULT_ADMIN_PRODUCT_FILTERS.syncStatus,
      sortBy:
        (readParamValue(input, 'sortBy') as
          | Required<AdminProductFilters>['sortBy']
          | undefined) || DEFAULT_ADMIN_PRODUCT_FILTERS.sortBy,
      sortOrder:
        (readParamValue(input, 'sortOrder') as
          | Required<AdminProductFilters>['sortOrder']
          | undefined) || DEFAULT_ADMIN_PRODUCT_FILTERS.sortOrder
    },
    productId
  }
}

export function buildAdminProductsSearchParams(
  state: AdminProductsUrlState
): URLSearchParams {
  const params = new URLSearchParams()
  const { filters, productId } = state

  if (filters.q) params.set('q', filters.q)
  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.limit !== DEFAULT_ADMIN_PRODUCT_FILTERS.limit) {
    params.set('limit', String(filters.limit))
  }
  if (filters.brandId != null) params.set('brand', String(filters.brandId))
  if (filters.categoryId != null) {
    params.set('category', String(filters.categoryId))
  }
  if (filters.stockStatus !== DEFAULT_ADMIN_PRODUCT_FILTERS.stockStatus) {
    params.set('stockStatus', filters.stockStatus)
  }
  if (filters.providerId != null) {
    params.set('provider', String(filters.providerId))
  }
  if (filters.visibility !== DEFAULT_ADMIN_PRODUCT_FILTERS.visibility) {
    params.set('visibility', filters.visibility)
  }
  if (filters.syncStatus !== DEFAULT_ADMIN_PRODUCT_FILTERS.syncStatus) {
    params.set('syncStatus', filters.syncStatus)
  }
  if (filters.sortBy !== DEFAULT_ADMIN_PRODUCT_FILTERS.sortBy) {
    params.set('sortBy', filters.sortBy)
  }
  if (filters.sortOrder !== DEFAULT_ADMIN_PRODUCT_FILTERS.sortOrder) {
    params.set('sortOrder', filters.sortOrder)
  }
  if (productId) params.set('productId', productId)

  return params
}
