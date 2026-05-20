'use client'

/**
 * useSearch Hook
 *
 * Production-ready faceted search hook with disjunctive faceting.
 * Uses Meilisearch multi-search API for proper facet counts.
 *
 * Key features:
 * - URL sync via useSearchParams
 * - Disjunctive faceting (selecting "Bosch" doesn't hide other brands)
 * - Debounced search
 * - Type-safe filters
 */

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { useDebounce } from 'use-debounce'
import { extractVehicleTypeIdFromSlug } from '@/lib/utils/vehicleSlug'
import type {
  SearchFilters,
  SearchHit,
  FacetGroup,
  FacetOption,
  UseSearchResult,
  FacetDistribution
} from '@/lib/types/search'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT = 24
const DEBOUNCE_MS = 300

// Delimiter for multi-value URL params (can't use comma since category names may contain commas)
const MULTI_VALUE_DELIMITER = '|'

const PARAM_KEYS = {
  QUERY: 'q',
  VARIANT: 'variant',
  BRANDS: 'brands',
  CATEGORIES: 'categories',
  MIN_PRICE: 'minPrice',
  MAX_PRICE: 'maxPrice',
  SORT: 'sort',
  PAGE: 'page'
} as const

// Facet configuration - use the actual filterable field names
const FACET_CONFIG = [
  { field: 'brandName', label: 'Markalar', idField: 'brandId' },
  { field: 'categoryName', label: 'Kategoriler', idField: 'categoryId' }
] as const

// ============================================================================
// URL Parsing Helpers
// ============================================================================

function parseFiltersFromURL(searchParams: URLSearchParams): SearchFilters {
  const brands = searchParams.get(PARAM_KEYS.BRANDS)
  const categories = searchParams.get(PARAM_KEYS.CATEGORIES)
  const variant = searchParams.get(PARAM_KEYS.VARIANT) || undefined

  const sortParam = searchParams.get(PARAM_KEYS.SORT)
  const sort: SearchFilters['sort'] =
    sortParam && ['popularity', 'price-asc', 'price-desc', 'name'].includes(sortParam)
      ? (sortParam as SearchFilters['sort'])
      : 'popularity'

  return {
    query: searchParams.get(PARAM_KEYS.QUERY) || '',
    variant,
    brands: brands
      ? brands.split(MULTI_VALUE_DELIMITER).filter(Boolean)
      : [],
    categories: categories
      ? categories.split(MULTI_VALUE_DELIMITER).filter(Boolean)
      : [],
    minPrice: searchParams.get(PARAM_KEYS.MIN_PRICE)
      ? Number(searchParams.get(PARAM_KEYS.MIN_PRICE))
      : undefined,
    maxPrice: searchParams.get(PARAM_KEYS.MAX_PRICE)
      ? Number(searchParams.get(PARAM_KEYS.MAX_PRICE))
      : undefined,
    sort,
    page: Number(searchParams.get(PARAM_KEYS.PAGE)) || 1,
    limit: DEFAULT_LIMIT
  }
}

function filtersToURLParams(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams()

  if (filters.query) params.set(PARAM_KEYS.QUERY, filters.query)
  if (filters.variant) params.set(PARAM_KEYS.VARIANT, filters.variant)
  if (filters.brands.length > 0)
    params.set(PARAM_KEYS.BRANDS, filters.brands.join(MULTI_VALUE_DELIMITER))
  if (filters.categories.length > 0)
    params.set(
      PARAM_KEYS.CATEGORIES,
      filters.categories.join(MULTI_VALUE_DELIMITER)
    )
  if (filters.minPrice !== undefined)
    params.set(PARAM_KEYS.MIN_PRICE, String(filters.minPrice))
  if (filters.maxPrice !== undefined)
    params.set(PARAM_KEYS.MAX_PRICE, String(filters.maxPrice))
  if (filters.sort && filters.sort !== 'popularity')
    params.set(PARAM_KEYS.SORT, filters.sort)
  if (filters.page > 1) params.set(PARAM_KEYS.PAGE, String(filters.page))

  return params
}

// ============================================================================
// Filter Building Helpers
// ============================================================================

function buildMeilisearchFilter(
  filters: SearchFilters,
  excludeFacet?: 'brandName' | 'categoryName'
): string {
  const conditions: string[] = []

  // Brand filter (skip if we're calculating brand facet distribution)
  if (filters.brands.length > 0 && excludeFacet !== 'brandName') {
    const brandNames = filters.brands.map((b) => `"${b}"`).join(', ')
    conditions.push(`brandName IN [${brandNames}]`)
  }

  // Category filter (skip if we're calculating category facet distribution)
  if (filters.categories.length > 0 && excludeFacet !== 'categoryName') {
    const categoryNames = filters.categories.map((c) => `"${c}"`).join(', ')
    conditions.push(`categoryName IN [${categoryNames}]`)
  }

  // Price filters
  if (filters.minPrice !== undefined) {
    conditions.push(`price >= ${filters.minPrice}`)
  }
  if (filters.maxPrice !== undefined) {
    conditions.push(`price <= ${filters.maxPrice}`)
  }

  return conditions.join(' AND ')
}

function getMeiliSort(sort: SearchFilters['sort']): string[] {
  switch (sort) {
    case 'price-asc':
      return ['price:asc']
    case 'price-desc':
      return ['price:desc']
    case 'name':
      return ['name:asc']
    case 'popularity':
    default:
      return []
  }
}

// ============================================================================
// Main Hook
// ============================================================================

export function useSearch(): UseSearchResult {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  // Parse filters from URL
  const filters = useMemo(
    () => parseFiltersFromURL(searchParams),
    [searchParams]
  )

  // Debounce the query for API calls
  const [debouncedQuery] = useDebounce(filters.query, DEBOUNCE_MS)
  const vehicleTypeId = useMemo(
    () =>
      filters.variant ? extractVehicleTypeIdFromSlug(filters.variant) : null,
    [filters.variant]
  )

  // State
  const [hits, setHits] = useState<SearchHit[]>([])
  const [totalHits, setTotalHits] = useState(0)
  const [facetDistributions, setFacetDistributions] = useState<
    Record<string, FacetDistribution>
  >({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Brand/Category name maps (populated from search results)
  const [brandNames, setBrandNames] = useState<Map<number, string>>(new Map())
  const [categoryNames, setCategoryNames] = useState<Map<number, string>>(
    new Map()
  )

  // ============================================================================
  // Multi-Search with Disjunctive Faceting
  // ============================================================================

  useEffect(() => {
    const controller = new AbortController()

    const performSearch = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Use server-side API endpoint with Redis caching
        const response = await fetch('/api/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            query: debouncedQuery,
            filters: {
              brands: filters.brands,
              categories: filters.categories,
              minPrice: filters.minPrice,
              maxPrice: filters.maxPrice,
              vehicleIds: vehicleTypeId ? [vehicleTypeId] : undefined
            },
            page: filters.page,
            limit: filters.limit,
            sort: filters.sort,
            multiSearch: true // Enable multi-search for disjunctive faceting
          })
        })

        if (!response.ok) {
          throw new Error(`Search API error: ${response.status} ${response.statusText}`)
        }

        const contentType = response.headers.get('content-type') || ''
        if (!contentType.includes('application/json')) {
          throw new Error(`Search API returned non-JSON response: ${contentType}`)
        }

        const data = await response.json()
        if (controller.signal.aborted) return

        // Process multi-search results
        const mainResults = data.results[0]
        setHits(mainResults.hits as SearchHit[])
        setTotalHits(mainResults.estimatedTotalHits || 0)

        // Update brand/category name maps from hits
        const newBrandNames = new Map(brandNames)
        const newCategoryNames = new Map(categoryNames)

        ;(mainResults.hits as SearchHit[]).forEach((hit) => {
          if (hit.brandId && hit.brandName) {
            newBrandNames.set(hit.brandId, hit.brandName)
          }
          if (hit.categoryId && hit.categoryName) {
            newCategoryNames.set(hit.categoryId, hit.categoryName)
          }
        })

        setBrandNames(newBrandNames)
        setCategoryNames(newCategoryNames)

        // Store facet distributions (use disjunctive results)
        setFacetDistributions({
          brandName: data.results[1].facetDistribution || {},
          categoryName: data.results[2].facetDistribution || {}
        })
      } catch (err) {
        if (controller.signal.aborted) return
        console.error('❌ Search error:', err)
        setError(err instanceof Error ? err : new Error('Search failed'))
        setHits([])
        setTotalHits(0)
        setFacetDistributions({})
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    performSearch()

    return () => controller.abort()
  }, [
    debouncedQuery,
    filters.brands,
    filters.categories,
    filters.page,
    filters.minPrice,
    filters.maxPrice,
    filters.sort,
    filters.variant,
    vehicleTypeId
  ])

  // ============================================================================
  // Build Facet Groups for UI
  // ============================================================================

  const facets = useMemo<FacetGroup[]>(() => {
    return FACET_CONFIG.map(({ field, label }) => {
      const distribution = facetDistributions[field]?.[field] || {}

      const options: FacetOption[] = Object.entries(distribution)
        .map(([value, count]) => {
          // Determine if this option is selected
          let isSelected = false
          if (field === 'brandName') {
            // We need to check by brand name (value) or find the ID
            // For now, we'll need to handle this differently
            // Since we're using brandName as facet but filtering by brandId
            isSelected = false // Will be enhanced
          } else if (field === 'categoryName') {
            isSelected = false // Will be enhanced
          }

          return {
            value,
            label: value,
            count,
            isSelected
          }
        })
        .sort((a, b) => b.count - a.count) // Sort by count descending

      return {
        field,
        label,
        options
      }
    })
  }, [facetDistributions, filters.brands, filters.categories])

  // ============================================================================
  // URL Update Functions
  // ============================================================================

  const updateURL = useCallback(
    (newFilters: SearchFilters) => {
      const params = filtersToURLParams(newFilters)
      const newURL = params.toString() ? `${pathname}?${params}` : pathname
      startTransition(() => {
        router.replace(newURL, { scroll: false })
      })
    },
    [router, pathname, startTransition]
  )

  const setFilter = useCallback(
    <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
      const newFilters = {
        ...filters,
        [key]: value,
        ...(key !== 'page' ? { page: 1 } : {})
      }
      updateURL(newFilters)
    },
    [filters, updateURL]
  )

  const toggleFacet = useCallback(
    (field: string, value: string) => {
      if (field === 'brandName') {
        const newBrands = filters.brands.includes(value)
          ? filters.brands.filter((b) => b !== value)
          : [...filters.brands, value]
        setFilter('brands', newBrands)
      } else if (field === 'categoryName') {
        const newCategories = filters.categories.includes(value)
          ? filters.categories.filter((c) => c !== value)
          : [...filters.categories, value]
        setFilter('categories', newCategories)
      }
    },
    [filters, setFilter]
  )

  const clearFilters = useCallback(() => {
    const newFilters: SearchFilters = {
      query: filters.query, // Keep the query
      variant: filters.variant,
      brands: [],
      categories: [],
      page: 1,
      limit: DEFAULT_LIMIT
    }
    updateURL(newFilters)
  }, [filters.query, updateURL])

  const setQuery = useCallback(
    (query: string) => {
      setFilter('query', query)
    },
    [setFilter]
  )

  // ============================================================================
  // Return
  // ============================================================================

  return {
    filters,
    hits,
    totalHits,
    facets,
    isLoading,
    error,
    setFilter,
    toggleFacet,
    clearFilters,
    setQuery
  }
}

export default useSearch
