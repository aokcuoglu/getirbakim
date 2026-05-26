export const BRAND_PAGE_DEFAULT_LIMIT = 24
export const BRAND_PAGE_MAX_LIMIT = 48
export const BRAND_PAGE_MULTI_VALUE_DELIMITER = '|'

export type BrandPageSort = 'popularity' | 'price-asc' | 'price-desc' | 'name'
export type BrandPageStockStatus = 'in-stock' | 'on-order'

export type BrandPageFilters = {
  page: number
  limit: number
  sort: BrandPageSort
  stock: BrandPageStockStatus[]
  minPrice?: number
  maxPrice?: number
}

export type BrandPageSearchParams = {
  page?: string
  limit?: string
  sort?: string
  stock?: string
  minPrice?: string
  maxPrice?: string
}

function parseStockParam(value: string | undefined): BrandPageStockStatus[] {
  if (!value) return []

  return value
    .split(BRAND_PAGE_MULTI_VALUE_DELIMITER)
    .filter(
      (item): item is BrandPageStockStatus =>
        item === 'in-stock' || item === 'on-order'
    )
}

function parseSortParam(value: string | undefined): BrandPageSort {
  if (
    value === 'price-asc' ||
    value === 'price-desc' ||
    value === 'name' ||
    value === 'popularity'
  ) {
    return value
  }

  return 'popularity'
}

function parsePriceParam(value: string | undefined): number | undefined {
  if (!value) return undefined

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function parseBrandPageFilters(
  searchParams: BrandPageSearchParams
): BrandPageFilters {
  const page = Number.parseInt(searchParams.page ?? '1', 10)
  const limit = Number.parseInt(searchParams.limit ?? String(BRAND_PAGE_DEFAULT_LIMIT), 10)

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit:
      Number.isFinite(limit) && limit > 0
        ? Math.min(limit, BRAND_PAGE_MAX_LIMIT)
        : BRAND_PAGE_DEFAULT_LIMIT,
    sort: parseSortParam(searchParams.sort),
    stock: parseStockParam(searchParams.stock),
    minPrice: parsePriceParam(searchParams.minPrice),
    maxPrice: parsePriceParam(searchParams.maxPrice)
  }
}

export function buildBrandPageSearchParams(
  filters: BrandPageFilters
): Record<string, string> {
  const params: Record<string, string> = {}

  if (filters.page > 1) {
    params.page = String(filters.page)
  }

  if (filters.limit !== BRAND_PAGE_DEFAULT_LIMIT) {
    params.limit = String(filters.limit)
  }

  if (filters.sort !== 'popularity') {
    params.sort = filters.sort
  }

  if (filters.stock.length > 0) {
    params.stock = filters.stock.join(BRAND_PAGE_MULTI_VALUE_DELIMITER)
  }

  if (filters.minPrice != null) {
    params.minPrice = String(filters.minPrice)
  }

  if (filters.maxPrice != null) {
    params.maxPrice = String(filters.maxPrice)
  }

  return params
}

export function buildBrandPageHref(
  locale: string,
  brandMatchId: number,
  filters: BrandPageFilters
): string {
  const base = `/${locale}/marka/${brandMatchId}`
  const params = new URLSearchParams(buildBrandPageSearchParams(filters))
  const query = params.toString()

  return query ? `${base}?${query}` : base
}
