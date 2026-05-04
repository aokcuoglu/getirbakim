'use client'

/**
 * CategoryClientWrapper - Server-Hydrated
 *
 * High-performance category page with server-side data hydration.
 * Initial page load data comes from RSC (no client-side waterfall).
 * Subsequent filter/pagination changes use client-side API calls.
 */

import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import type { CatalogArticlesResult } from '@/lib/actions/getCatalogArticles'
import { useCategorySearch } from '@/hooks/use-category-search'
import { CategoryContent } from './CategoryContent'
import type { PartWithDetails } from '@/lib/actions/getPartsForVehicle'
import type { SearchHit } from '@/lib/types/search'
import { SearchSidebar } from '@/components/search/SearchSidebar'
import { CategoryNavigation } from '@/components/search/CategoryNavigation'
import { useLocale } from 'next-intl'
import { useMemo } from 'react'

interface CategoryClientWrapperProps {
  category: TrodoCategoryWithHierarchy
  variantSlug?: string
  navigationMode?: 'slug' | 'catalog-query'
  catalogPath?: string
  resolvedVehicleId?: number | null
  vehicleResolutionFailed?: boolean
  initialData?: CatalogArticlesResult
}

// Convert SearchHit to PartWithDetails format for CategoryContent
function mapHitToPart(hit: SearchHit, locale: string): PartWithDetails {
  return {
    id: parseInt(hit.id, 10),
    name: hit.name,
    dedupeKey: hit.dedupeKey,
    variantCount: hit.variantCount,
    sourceType: hit.sourceType,
    resolvedPartId: hit.resolvedPartId,
    supplierProductId: hit.supplierProductId ?? null,
    providerCode: hit.providerCode ?? null,
    supplierSku: hit.supplierSku ?? null,
    matchType: hit.matchType,
    canonicalKey: hit.canonicalKey,
    rankBucket: hit.rankBucket,
    price: hit.price,
    priceSource: hit.priceSource,
    isPlaceholderPrice: hit.isPlaceholderPrice,
    isPurchasable: hit.isPurchasable,
    stock: hit.stockQty,
    brand: {
      id: hit.brandId,
      name: hit.brandName,
      logoUrl: hit.brandLogo ?? null
    },
    images: hit.images || [],
    properties: (hit.properties || []).map((p) => ({
      key: locale === 'tr' && p.key_tr ? p.key_tr : p.key,
      value: locale === 'tr' && p.value_tr ? p.value_tr : p.value
    })),
    eans: hit.oemCodes || []
  }
}

export function CategoryClientWrapper({
  category,
  variantSlug,
  navigationMode = 'catalog-query',
  catalogPath = '/catalog',
  resolvedVehicleId,
  vehicleResolutionFailed = false,
  initialData
}: CategoryClientWrapperProps) {
  const locale = useLocale()
  // categorySearchQuery removed as it is now handled in CategoryNavigation

  // Extract vehicle ID (TecDoc ID) from resolvedVehicleId
  // resolvedVehicleId is the tecdoc_id from variants table, which matches vehicle_types.id
  // This is used to filter parts in Meilisearch using vehicleIds field
  const vehicleId = useMemo(() => {
    // Prefer server-resolved vehicle ID (TecDoc ID) if available
    // This is the correct ID to use for filtering in Meilisearch
    if (resolvedVehicleId !== null && resolvedVehicleId !== undefined) {
      return resolvedVehicleId
    }

    // If resolution failed but we have a variantSlug, we can't filter by vehicle
    // Return null to show all products (with warning banner)
    return null
  }, [resolvedVehicleId])

  // Memoize searchIds to prevent infinite re-renders in useCategorySearch
  const stableSearchIds = useMemo(
    () => category.searchIds,
    [category.searchIds]
  )

  // Use search hook with server-side hydration data
  const {
    hits,
    totalHits,
    facets,
    currentPage,
    totalPages,
    isLoading,
    filters,
    setPage,
    setSort,
    setLimit,
    toggleBrand,
    toggleStock,
    clearBrands,
    clearStock,
    setMinPrice,
    setMaxPrice
  } = useCategorySearch(category.name, stableSearchIds, vehicleId, initialData)

  const dedupedHits = useMemo(() => {
    const byKey = new Map<string, SearchHit>()

    for (const hit of hits) {
      const canonicalKey = hit.canonicalKey?.trim()
      const dedupeKey = hit.dedupeKey?.trim()
      const key =
        (canonicalKey && canonicalKey.length > 0
          ? canonicalKey
          : dedupeKey && dedupeKey.length > 0
            ? dedupeKey
            : `id:${hit.id}`)
      const existing = byKey.get(key)

      if (!existing) {
        byKey.set(key, hit)
        continue
      }

      const existingRank = existing.rankBucket ?? 1
      const currentRank = hit.rankBucket ?? 1

      if (currentRank < existingRank) {
        byKey.set(key, hit)
        continue
      }

      if (currentRank === existingRank) {
        const existingVariantCount = existing.variantCount ?? 1
        const currentVariantCount = hit.variantCount ?? 1
        if (currentVariantCount > existingVariantCount) {
          byKey.set(key, hit)
        }
      }
    }

    return Array.from(byKey.values())
  }, [hits])

  // Convert hits to PartWithDetails - brand logos already included in hit data
  const parts = useMemo(() => {
    return dedupedHits.map((h) => mapHitToPart(h, locale))
  }, [dedupedHits, locale])

  const activeFilterCount =
    filters.brands.length +
    filters.stock.length +
    (filters.minPrice != null ? 1 : 0) +
    (filters.maxPrice != null ? 1 : 0)

  // Check if vehicle is selected but no products found or vehicle filtering failed
  // This includes both cases:
  // 1. Vehicle resolved but no products (resolvedVehicleId exists, totalHits === 0)
  // 2. Vehicle resolution failed (vehicleResolutionFailed = true, variantSlug exists)
  //    - In this case, filtering doesn't work, so we show all products but warn the user
  const hasVehicleSelected = useMemo(() => {
    // If no vehicle slug, no vehicle is selected
    if (!variantSlug || isLoading) return false

    // Case 1: Vehicle resolved but no products found for this vehicle
    if (
      resolvedVehicleId !== null &&
      resolvedVehicleId !== undefined &&
      totalHits === 0
    ) {
      return true
    }

    // Case 2: Vehicle resolution failed - filtering doesn't work, all products shown
    // Show message even if totalHits > 0 because filtering didn't work
    if (vehicleResolutionFailed) {
      return true
    }

    return false
  }, [
    variantSlug,
    resolvedVehicleId,
    isLoading,
    totalHits,
    vehicleResolutionFailed
  ])

  // Handlers
  const handleToggleFacet = (field: string, value: string) => {
    if (field === 'brandName') {
      toggleBrand(value)
      return
    }

    if (field === 'stockStatus') {
      if (value === 'in-stock' || value === 'on-order') {
        toggleStock(value)
      }
    }
  }

  const handleClearFilters = () => {
    clearBrands()
    clearStock()
    setMinPrice(undefined)
    setMaxPrice(undefined)
  }

  const handlePageChange = (page: number) => {
    setPage(page)
  }

  // Category selection UI for sidebar
  // We use the unified CategoryNavigation component here
  // which handles parent links, search, and sibling/child rendering.
  const categoryExtraSections = (
    <CategoryNavigation
      category={category}
      variantSlug={variantSlug}
      hideTitle={true} // Category navigation title is managed by sidebar shell
      navigationMode={navigationMode}
      catalogPath={catalogPath}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Removed warning banner - now shown in main content area via CategoryContent */}
      <div className="flex flex-col lg:flex-row gap-5 xl:gap-6">
        <SearchSidebar
          facets={facets}
          selectedBrands={filters.brands}
          selectedCategories={[]}
          selectedStockStatuses={filters.stock}
          onToggleFacet={handleToggleFacet}
          onClearFilters={handleClearFilters}
          isLoading={isLoading}
          extraSections={categoryExtraSections}
          minPrice={filters.minPrice}
          maxPrice={filters.maxPrice}
          onMinPriceChange={setMinPrice}
          onMaxPriceChange={setMaxPrice}
        />
        <CategoryContent
          category={category}
          variantSlug={variantSlug}
          navigationMode={navigationMode}
          catalogPath={catalogPath}
          parts={parts}
          totalParts={totalHits}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          sortBy={filters.sort ?? 'popularity'}
          perPage={String(filters.limit)}
          onSortChange={setSort}
          onPerPageChange={(value) => setLimit(parseInt(value, 10))}
          isLoading={isLoading}
          facets={facets}
          activeBrands={filters.brands}
          activeStockStatuses={filters.stock}
          onBrandChange={(brand) => toggleBrand(brand)}
          onStockStatusChange={(stockStatus) => toggleStock(stockStatus)}
          activeFilterCount={activeFilterCount}
          onClearFilters={handleClearFilters}
          extraSidebarSections={categoryExtraSections}
          hasVehicleSelected={hasVehicleSelected}
          priceLoadingIds={new Set<number>()}
        />
      </div>
    </div>
  )
}
