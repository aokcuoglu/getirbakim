'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import type { SearchHit, FacetGroup, FacetOption } from '@/lib/types/search'
import {
  keepPreviousData,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'

interface CategoryProductsResponse {
  products: SearchHit[]
  page: number
  limit: number
  hasMore: boolean
  totalEstimate: number | null
  brandFacetDistribution: Record<string, number>
  stockFacetDistribution: Record<string, number>
  dataSource: string
  durationMs: number
  cached: boolean
  requestId: string
  rate: { limit: number; remaining: number; retryAfterSeconds: number }
}

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 48
const MULTI_VALUE_DELIMITER = '|'

const PARAM_KEYS = {
  BRANDS: 'brands',
  STOCK: 'stock',
  PAGE: 'page',
  SORT: 'sort',
  LIMIT: 'limit',
  MIN_PRICE: 'minPrice',
  MAX_PRICE: 'maxPrice'
} as const

interface CategorySearchFilters {
  categorySlug: string
  categoryName: string
  searchIds?: number[]
  vehicleId?: number | null
  brands: string[]
  stock: Array<'in-stock' | 'on-order'>
  page: number
  limit: number
  sort?: 'popularity' | 'price-asc' | 'price-desc' | 'name'
  minPrice?: number
  maxPrice?: number
}

interface UseCategorySearchResult {
  hits: SearchHit[]
  totalHits: number
  facets: FacetGroup[]
  currentPage: number
  totalPages: number
  isLoading: boolean
  error: Error | null
  filters: CategorySearchFilters
  setPage: (page: number) => void
  toggleBrand: (brandName: string) => void
  toggleStock: (stockStatus: 'in-stock' | 'on-order') => void
  clearBrands: () => void
  clearStock: () => void
  setSort: (sort: CategorySearchFilters['sort']) => void
  setLimit: (limit: number) => void
  setMinPrice: (price: number | undefined) => void
  setMaxPrice: (price: number | undefined) => void
}

function parseFiltersFromURL(
  searchParams: URLSearchParams,
  categorySlug: string,
  categoryName: string,
  searchIds: number[] = [],
  vehicleId: number | null = null
): CategorySearchFilters {
  const brands = searchParams.get(PARAM_KEYS.BRANDS)
  const stock = searchParams.get(PARAM_KEYS.STOCK)
  const limit = searchParams.get(PARAM_KEYS.LIMIT)
  return {
    categorySlug,
    categoryName,
    searchIds,
    vehicleId,
    brands: brands ? brands.split(MULTI_VALUE_DELIMITER).filter(Boolean) : [],
    stock: stock
      ? stock
          .split(MULTI_VALUE_DELIMITER)
          .filter(
            (value): value is 'in-stock' | 'on-order' =>
              value === 'in-stock' || value === 'on-order'
          )
      : [],
    page: Number(searchParams.get(PARAM_KEYS.PAGE)) || 1,
    limit: limit ? Math.min(parseInt(limit, 10), MAX_LIMIT) : DEFAULT_LIMIT,
    sort:
      (searchParams.get(PARAM_KEYS.SORT) as CategorySearchFilters['sort']) ||
      'popularity',
    minPrice: searchParams.get(PARAM_KEYS.MIN_PRICE)
      ? Number(searchParams.get(PARAM_KEYS.MIN_PRICE))
      : undefined,
    maxPrice: searchParams.get(PARAM_KEYS.MAX_PRICE)
      ? Number(searchParams.get(PARAM_KEYS.MAX_PRICE))
      : undefined
  }
}

function buildFacetGroups(
  brandDistribution: Record<string, number>,
  stockDistribution: Record<string, number>,
  filters: CategorySearchFilters
): FacetGroup[] {
  const brandOptions: FacetOption[] = Object.entries(brandDistribution)
    .map(([name, count]) => ({
      value: name,
      label: name,
      count: count as number,
      isSelected: filters.brands.includes(name)
    }))
    .sort((a, b) => b.count - a.count)

  return [
    {
      field: 'brandName',
      label: 'Markalar',
      options: brandOptions
    },
    {
      field: 'stockStatus',
      label: 'Stok durumu',
      options: [
        {
          value: 'in-stock',
          label: 'In stock',
          count: stockDistribution['in-stock'] || 0,
          isSelected: filters.stock.includes('in-stock')
        },
        {
          value: 'on-order',
          label: 'On order',
          count: stockDistribution['on-order'] || 0,
          isSelected: filters.stock.includes('on-order')
        }
      ]
    }
  ]
}

function serializeFiltersForKey(filters: CategorySearchFilters): string {
  return JSON.stringify({
    slug: filters.categorySlug,
    ids: filters.searchIds,
    vid: filters.vehicleId,
    brands: filters.brands,
    stock: filters.stock,
    page: filters.page,
    limit: filters.limit,
    sort: filters.sort,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice
  })
}

async function fetchCategoryProducts(
  locale: string,
  filters: CategorySearchFilters,
  signal?: AbortSignal
): Promise<{ hits: SearchHit[]; totalHits: number; brandFacetDistribution: Record<string, number>; stockFacetDistribution: Record<string, number>; page: number; limit: number; hasMore: boolean }> {
  const params = new URLSearchParams()
  params.set('locale', locale)
  params.set('slug', filters.categorySlug)
  params.set('page', String(filters.page))
  params.set('limit', String(filters.limit))

  if (filters.vehicleId != null) {
    params.set('vehicleId', String(filters.vehicleId))
  }

  if (filters.brands.length > 0) {
    params.set('brands', filters.brands.join(MULTI_VALUE_DELIMITER))
  }

  if (filters.stock.length > 0) {
    params.set('stock', filters.stock.join(MULTI_VALUE_DELIMITER))
  }

  if (filters.sort && filters.sort !== 'popularity') {
    params.set('sort', filters.sort)
  }

  if (filters.minPrice != null) {
    params.set('minPrice', String(filters.minPrice))
  }

  if (filters.maxPrice != null) {
    params.set('maxPrice', String(filters.maxPrice))
  }

  const endpoint = `/api/category-products?${params.toString()}`
  const t0 = performance.now()
  let status = 0
  let resultCount = 0
  let source = 'unknown'

  try {
    const response = await fetch(endpoint, { signal })
    status = response.status

    if (!response.ok) {
      const durationMs = Number((performance.now() - t0).toFixed(1))
      console.error(
        `[category-products] endpoint=${endpoint} category=${filters.categorySlug} durationMs=${durationMs} status=${status} resultCount=0 source=error`
      )
      throw new Error(`Category products fetch failed with status ${status}`)
    }

    const data = (await response.json()) as CategoryProductsResponse
    const durationMs = Number((performance.now() - t0).toFixed(1))
    resultCount = data.products?.length ?? 0
    source = data.dataSource ?? 'unknown'

    console.log(
      `[category-products] endpoint=/api/category-products category=${filters.categorySlug} durationMs=${durationMs} status=${status} resultCount=${resultCount} source=${source}`
    )

    return {
      hits: data.products ?? [],
      totalHits: data.totalEstimate ?? 0,
      brandFacetDistribution: data.brandFacetDistribution ?? {},
      stockFacetDistribution: data.stockFacetDistribution ?? {},
      page: data.page ?? 1,
      limit: data.limit ?? DEFAULT_LIMIT,
      hasMore: data.hasMore ?? false
    }
  } catch (error) {
    const durationMs = Number((performance.now() - t0).toFixed(1))
    console.error(
      `[category-products] endpoint=${endpoint} category=${filters.categorySlug} durationMs=${durationMs} status=${status} resultCount=${resultCount} source=${source} error=${error instanceof Error ? error.message : String(error)}`
    )
    throw error
  }
}

function buildUrlFromFilters(pathname: string, filters: CategorySearchFilters): string {
  const params = new URLSearchParams()

  if (filters.brands.length > 0) {
    params.set(PARAM_KEYS.BRANDS, filters.brands.join(MULTI_VALUE_DELIMITER))
  }

  if (filters.stock.length > 0) {
    params.set(PARAM_KEYS.STOCK, filters.stock.join(MULTI_VALUE_DELIMITER))
  }

  if (filters.page > 1) {
    params.set(PARAM_KEYS.PAGE, String(filters.page))
  }

  if (filters.sort && filters.sort !== 'popularity') {
    params.set(PARAM_KEYS.SORT, filters.sort)
  }

  if (filters.limit !== DEFAULT_LIMIT) {
    params.set(PARAM_KEYS.LIMIT, String(filters.limit))
  }

  if (filters.minPrice != null) {
    params.set(PARAM_KEYS.MIN_PRICE, String(filters.minPrice))
  }

  if (filters.maxPrice != null) {
    params.set(PARAM_KEYS.MAX_PRICE, String(filters.maxPrice))
  }

  const queryString = params.toString()
  return queryString ? `${pathname}?${queryString}` : pathname
}

export function useCategorySearch(
  categoryName: string,
  searchIds: number[] = [],
  vehicleId: number | null = null,
  _deprecatedInitialData?: unknown
): UseCategorySearchResult {
  const locale = useLocale()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()

  const categorySlug = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean)
    return segments.length >= 2 ? segments[1] : ''
  }, [pathname])

  const initialFilters = useMemo(
    () => parseFiltersFromURL(searchParams, categorySlug, categoryName, searchIds, vehicleId),
    [searchParams, categorySlug, categoryName, searchIds, vehicleId]
  )
  const [filters, setFilters] = useState<CategorySearchFilters>(initialFilters)

  useEffect(() => {
    setFilters(initialFilters)
  }, [initialFilters])

  const serializedFilters = useMemo(
    () => serializeFiltersForKey(filters),
    [filters]
  )

  const { data, isFetching, error: queryError } = useQuery<
    { hits: SearchHit[]; totalHits: number; brandFacetDistribution: Record<string, number>; stockFacetDistribution: Record<string, number>; page: number; limit: number; hasMore: boolean },
    Error
  >({
    queryKey: ['category-products', serializedFilters],
    queryFn: ({ signal }) => fetchCategoryProducts(locale, filters, signal),
    enabled: Boolean(categorySlug),
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000
  })

  const hits = data?.hits ?? []
  const totalHits = data?.totalHits ?? 0
  const facets = useMemo(
    () => buildFacetGroups(data?.brandFacetDistribution ?? {}, data?.stockFacetDistribution ?? {}, filters),
    [data?.brandFacetDistribution, data?.stockFacetDistribution, filters]
  )
  const isLoading = isFetching && !data
  const error = queryError ?? null

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalHits / filters.limit)),
    [totalHits, filters.limit]
  )

  useEffect(() => {
    const handlePopState = () => {
      const nextFilters = parseFiltersFromURL(
        new URLSearchParams(window.location.search),
        categorySlug,
        categoryName,
        searchIds,
        vehicleId
      )
      setFilters(nextFilters)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [categorySlug, categoryName, searchIds, vehicleId])

  const updateURL = useCallback(
    (
      updates: Partial<CategorySearchFilters>,
      options?: { history?: 'push' | 'replace' }
    ) => {
      const nextFilters: CategorySearchFilters = {
        ...filters,
        ...updates
      }

      if (nextFilters.page < 1) {
        nextFilters.page = 1
      }

      const newUrl = buildUrlFromFilters(pathname, nextFilters)
      startTransition(() => {
        setFilters(nextFilters)
      })

      if (typeof window !== 'undefined') {
        const historyMethod =
          options?.history === 'push' ? 'pushState' : 'replaceState'
        window.history[historyMethod]({ categorySearch: true }, '', newUrl)
      }
    },
    [filters, pathname, startTransition]
  )

  useEffect(() => {
    if (filters.page < totalPages) {
      const nextFilters = { ...filters, page: filters.page + 1 }
      const key = serializeFiltersForKey(nextFilters)
      void queryClient.prefetchQuery({
        queryKey: ['category-products', key],
        queryFn: ({ signal }) => fetchCategoryProducts(locale, nextFilters, signal),
        staleTime: 60 * 1000
      })
    }
  }, [filters, totalPages, queryClient, locale])

  const setPage = useCallback(
    (page: number) => {
      updateURL({ page }, { history: 'push' })
    },
    [updateURL]
  )

  const toggleBrand = useCallback(
    (brandName: string) => {
      const newBrands = filters.brands.includes(brandName)
        ? filters.brands.filter((b) => b !== brandName)
        : [...filters.brands, brandName]
      updateURL({ brands: newBrands, page: 1 })
    },
    [filters.brands, updateURL]
  )

  const clearBrands = useCallback(() => {
    updateURL({ brands: [], page: 1 })
  }, [updateURL])

  const toggleStock = useCallback(
    (stockStatus: 'in-stock' | 'on-order') => {
      const newStock = filters.stock.includes(stockStatus)
        ? filters.stock.filter((status) => status !== stockStatus)
        : [...filters.stock, stockStatus]
      updateURL({ stock: newStock, page: 1 })
    },
    [filters.stock, updateURL]
  )

  const clearStock = useCallback(() => {
    updateURL({ stock: [], page: 1 })
  }, [updateURL])

  const setSort = useCallback(
    (sort: CategorySearchFilters['sort']) => {
      updateURL({ sort, page: 1 })
    },
    [updateURL]
  )

  const setLimit = useCallback(
    (limit: number) => {
      updateURL({ limit: Math.min(limit, MAX_LIMIT), page: 1 })
    },
    [updateURL]
  )

  const setMinPrice = useCallback(
    (price: number | undefined) => {
      updateURL({ minPrice: price ?? (null as any), page: 1 })
    },
    [updateURL]
  )

  const setMaxPrice = useCallback(
    (price: number | undefined) => {
      updateURL({ maxPrice: price ?? (null as any), page: 1 })
    },
    [updateURL]
  )

  return {
    hits,
    totalHits,
    facets,
    currentPage: filters.page,
    totalPages,
    isLoading,
    error,
    filters,
    setPage,
    toggleBrand,
    toggleStock,
    clearBrands,
    clearStock,
    setSort,
    setLimit,
    setMinPrice,
    setMaxPrice
  }
}

export type { CategorySearchFilters, UseCategorySearchResult }