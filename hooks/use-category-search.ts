'use client'

/**
 * useCategorySearch Hook
 *
 * Meilisearch-powered search for category pages.
 * Pre-filters by categoryName and provides brand faceting.
 *
 * Key features:
 * - Category-scoped search
 * - Brand filtering with disjunctive faceting
 * - URL sync (page, brands)
 * - Instant client-side updates
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { SearchHit, FacetGroup, FacetOption } from '@/lib/types/search'
import type { CatalogArticlesResult } from '@/lib/actions/getCatalogArticles'
import {
  keepPreviousData,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'

// ============================================================================
// Types
// ============================================================================

interface CategorySearchFilters {
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

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT = 24
// Delimiter for multi-value URL params (can't use comma since brand names may contain commas)
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

// ============================================================================
// URL Helpers
// ============================================================================

function parseFiltersFromURL(
  searchParams: URLSearchParams,
  categoryName: string,
  searchIds: number[] = [],
  vehicleId: number | null = null
): CategorySearchFilters {
  const brands = searchParams.get(PARAM_KEYS.BRANDS)
  const stock = searchParams.get(PARAM_KEYS.STOCK)
  const limit = searchParams.get(PARAM_KEYS.LIMIT)
  return {
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
    limit: limit ? parseInt(limit, 10) : DEFAULT_LIMIT,
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
  result: CatalogArticlesResult | undefined,
  filters: CategorySearchFilters
): FacetGroup[] {
  if (!result) return []

  const brandDistribution = result.brandFacetDistribution || {}
  const stockDistribution = result.stockFacetDistribution || {}

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
    categoryName: filters.categoryName,
    searchIds: filters.searchIds,
    vehicleId: filters.vehicleId,
    brands: filters.brands,
    stock: filters.stock,
    page: filters.page,
    limit: filters.limit,
    sort: filters.sort,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice
  })
}

async function fetchCatalogArticles(
  filters: CategorySearchFilters,
  signal?: AbortSignal
): Promise<CatalogArticlesResult> {
  const response = await fetch('/api/catalog/articles', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    signal,
    body: JSON.stringify({
      categoryName: filters.categoryName,
      searchIds: filters.searchIds,
      vehicleId: filters.vehicleId,
      brands: filters.brands,
      stockStatuses: filters.stock,
      page: filters.page,
      limit: filters.limit,
      sort: filters.sort,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      includePrice: true,
      includeHits: true,
      includeTotal: true,
      includeFacets: true
    })
  })

  if (!response.ok) {
    throw new Error(`Category search failed with status ${response.status}`)
  }

  return (await response.json()) as CatalogArticlesResult
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

// ============================================================================
// Main Hook
// ============================================================================

export function useCategorySearch(
  categoryName: string,
  searchIds: number[] = [],
  vehicleId: number | null = null,
  initialData?: CatalogArticlesResult
): UseCategorySearchResult {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [, startTransition] = useTransition()

  const initialFilters = useMemo(
    () => parseFiltersFromURL(searchParams, categoryName, searchIds, vehicleId),
    [searchParams, categoryName, searchIds, vehicleId]
  )
  const [filters, setFilters] = useState<CategorySearchFilters>(initialFilters)

  useEffect(() => {
    setFilters(initialFilters)
  }, [initialFilters])

  const serializedFilters = useMemo(
    () => serializeFiltersForKey(filters),
    [filters]
  )

  const initialDataKeyRef = useRef<string | null>(
    initialData ? serializedFilters : null
  )

  const {
    data,
    isFetching,
    error: queryError
  } = useQuery<CatalogArticlesResult, Error>({
    queryKey: ['category-search', serializedFilters],
    queryFn: ({ signal }) => fetchCatalogArticles(filters, signal),
    enabled: Boolean(categoryName),
    placeholderData: keepPreviousData,
    initialData:
      initialData && initialDataKeyRef.current === serializedFilters
        ? initialData
        : undefined,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000
  })

  const hits = data?.hits ?? []
  const totalHitsRaw = data?.totalHits
  const totalHits =
    typeof totalHitsRaw === 'number' && Number.isFinite(totalHitsRaw)
      ? totalHitsRaw
      : 0
  const facets = useMemo(() => buildFacetGroups(data, filters), [data, filters])
  const isLoading = isFetching && !data
  const error = queryError ?? null

  // Calculate pagination
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalHits / filters.limit)),
    [totalHits, filters.limit]
  )

  useEffect(() => {
    const handlePopState = () => {
      const nextFilters = parseFiltersFromURL(
        new URLSearchParams(window.location.search),
        categoryName,
        searchIds,
        vehicleId
      )
      setFilters(nextFilters)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [categoryName, searchIds, vehicleId])

  // URL/state update helper without App Router navigation.
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
    const targets: CategorySearchFilters[] = []

    if (filters.page < totalPages) {
      targets.push({ ...filters, page: filters.page + 1 })
    }

    if (filters.page > 1) {
      targets.push({ ...filters, page: filters.page - 1 })
    }

    const stockTargets: Array<'in-stock' | 'on-order'> = ['in-stock', 'on-order']
    stockTargets.forEach((stockStatus) => {
      const nextStock = filters.stock.includes(stockStatus)
        ? filters.stock.filter((value) => value !== stockStatus)
        : [...filters.stock, stockStatus]
      targets.push({ ...filters, stock: nextStock, page: 1 })
    })

    targets.forEach((targetFilters) => {
      const key = serializeFiltersForKey(targetFilters)
      void queryClient.prefetchQuery({
        queryKey: ['category-search', key],
        queryFn: ({ signal }) => fetchCatalogArticles(targetFilters, signal),
        staleTime: 30 * 1000
      })
    })
  }, [filters, totalPages, queryClient])

  // Actions
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
      updateURL({ limit, page: 1 })
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
