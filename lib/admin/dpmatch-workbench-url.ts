import type { AdminDpmatchFilters } from '@/lib/admin/dpmatch-catalog'

type SearchParamRecord = Record<string, string | string[] | undefined>

export type AdminDpmatchWorkbenchFilters = Required<
  Pick<
    AdminDpmatchFilters,
    | 'q'
    | 'dinamikBrand'
    | 'manufacturerId'
    | 'matchSide'
    | 'mappingStatus'
    | 'page'
    | 'limit'
  >
> & {
  stockStatus: 'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'zero_price'
}

export interface AdminDpmatchUrlState {
  filters: AdminDpmatchWorkbenchFilters
  productId: string | null
}

export const DEFAULT_DPMATCH_WORKBENCH_FILTERS: AdminDpmatchWorkbenchFilters = {
  q: '',
  dinamikBrand: null,
  manufacturerId: null,
  matchSide: 'all',
  mappingStatus: 'all',
  stockStatus: 'all',
  page: 1,
  limit: 50
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

export function parseDpmatchWorkbenchUrlState(
  input: URLSearchParams | SearchParamRecord
): AdminDpmatchUrlState {
  const page = parsePositiveInt(readParamValue(input, 'page'))
  const limit = parsePositiveInt(readParamValue(input, 'limit'))
  const manufacturerId = parsePositiveInt(readParamValue(input, 'manufacturerId'))
  const productId = (readParamValue(input, 'productId') || '').trim() || null
  const dinamikBrand = (readParamValue(input, 'dinamikBrand') || '').trim() || null
  const matchSide = readParamValue(input, 'matchSide') ?? 'all'
  const mappingStatus = readParamValue(input, 'mappingStatus') ?? 'all'
  const stockStatus = readParamValue(input, 'stockStatus') ?? 'all'

  return {
    filters: {
      q: (readParamValue(input, 'q') || '').trim(),
      page: page ?? DEFAULT_DPMATCH_WORKBENCH_FILTERS.page,
      limit: limit
        ? Math.min(limit, 200)
        : DEFAULT_DPMATCH_WORKBENCH_FILTERS.limit,
      dinamikBrand,
      manufacturerId,
      matchSide:
        matchSide === 'matched' ||
        matchSide === 'unmatched' ||
        matchSide === 'dinamik_only' ||
        matchSide === 'pt_only'
          ? matchSide
          : 'all',
      mappingStatus:
        mappingStatus === 'APPROVED' ||
        mappingStatus === 'PENDING' ||
        mappingStatus === 'REJECTED' ||
        mappingStatus === 'IGNORED'
          ? mappingStatus
          : 'all',
      stockStatus:
        stockStatus === 'in_stock' ||
        stockStatus === 'low_stock' ||
        stockStatus === 'out_of_stock' ||
        stockStatus === 'zero_price'
          ? stockStatus
          : 'all'
    },
    productId
  }
}

export function buildDpmatchWorkbenchSearchParams(
  state: AdminDpmatchUrlState
): URLSearchParams {
  const params = new URLSearchParams()
  const { filters, productId } = state

  if (filters.q) params.set('q', filters.q)
  if (filters.page > 1) params.set('page', String(filters.page))
  if (filters.limit !== DEFAULT_DPMATCH_WORKBENCH_FILTERS.limit) {
    params.set('limit', String(filters.limit))
  }
  if (filters.dinamikBrand) params.set('dinamikBrand', filters.dinamikBrand)
  if (filters.manufacturerId != null) {
    params.set('manufacturerId', String(filters.manufacturerId))
  }
  if (filters.matchSide !== 'all') params.set('matchSide', filters.matchSide)
  if (filters.mappingStatus !== 'all') {
    params.set('mappingStatus', filters.mappingStatus)
  }
  if (filters.stockStatus !== 'all') {
    params.set('stockStatus', filters.stockStatus)
  }
  if (productId) params.set('productId', productId)

  return params
}

export function toDpmatchCatalogFilters(
  filters: AdminDpmatchWorkbenchFilters
): AdminDpmatchFilters {
  return {
    q: filters.q,
    dinamikBrand: filters.dinamikBrand,
    manufacturerId: filters.manufacturerId,
    matchSide: filters.matchSide,
    mappingStatus: filters.mappingStatus,
    stockStatus: filters.stockStatus,
    page: filters.page,
    limit: filters.limit
  }
}
