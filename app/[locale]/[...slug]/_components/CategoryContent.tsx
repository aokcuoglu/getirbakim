'use client'

import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import type { PartWithDetails } from '@/lib/actions/getPartsForVehicle'
import Image from 'next/image'
import { ProductCard } from './ProductCard'
import { GridProductCard } from './GridProductCard'
import {
  Grid,
  List,
  ChevronLeft,
  ChevronRight,
  Package,
  Wrench
} from 'lucide-react'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { getLocalizedCategoryName } from '@/lib/utils/category-localization'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import { buildCategoryUrl as buildCanonicalCategoryUrl } from '@/lib/catalog-url'
import { Button } from '@/components/ui/button'
import { SearchSidebar } from '@/components/search/SearchSidebar'
import { MobileSidebarSheet } from '@/components/search/MobileSidebarSheet'
import { useCategoryPageNavigationOptional } from './CategoryPageNavigationContext'
import type { FacetGroup } from '@/lib/types/search'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Pagination } from '@/components/ui/Pagination'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Info } from 'lucide-react'

interface CategoryContentProps {
  category: TrodoCategoryWithHierarchy
  variantSlug?: string
  navigationMode?: 'slug' | 'catalog-query'
  catalogPath?: string
  parts?: PartWithDetails[]
  totalParts?: number
  currentPage?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  sortBy?: 'popularity' | 'price-asc' | 'price-desc' | 'name'
  perPage?: string
  onSortChange?: (value: 'popularity' | 'price-asc' | 'price-desc' | 'name') => void
  onPerPageChange?: (value: string) => void
  isLoading?: boolean
  facets?: FacetGroup[]
  activeBrands?: string[]
  activeStockStatuses?: string[]
  onBrandChange?: (brandName: string) => void
  onStockStatusChange?: (stockStatus: 'in-stock' | 'on-order') => void
  activeFilterCount?: number
  onClearFilters?: () => void
  extraSidebarSections?: React.ReactNode
  hasVehicleSelected?: boolean // True if vehicle is selected but no products found
  priceLoadingIds?: Set<number>
}

export function CategoryContent({
  category,
  variantSlug,
  navigationMode = 'catalog-query',
  catalogPath = '/catalog',
  parts = [],
  totalParts = 0,
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  sortBy: controlledSortBy,
  perPage: controlledPerPage,
  onSortChange,
  onPerPageChange,
  isLoading = false,
  facets = [],
  activeBrands = [],
  activeStockStatuses = [],
  onBrandChange,
  onStockStatusChange,
  activeFilterCount = 0,
  onClearFilters,
  extraSidebarSections,
  hasVehicleSelected = false,
  priceLoadingIds = new Set<number>()
}: CategoryContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const t = useTranslations('CategoryPage')
  const locale = useLocale()
  const visibleSubcategories = category.children || []
  const localizedCategoryName = getLocalizedCategoryName(category, locale)

  // ViewMode with localStorage persistence
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('categoryViewMode') as 'list' | 'grid') || 'list'
    }
    return 'list'
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('categoryViewMode', viewMode)
    }
  }, [viewMode])

  // Use client-managed values when available to avoid App Router navigations for
  // sort/limit updates. Fall back to URL params for non-leaf or standalone usage.
  const sortBy = controlledSortBy || searchParams.get('sort') || 'popularity'
  const perPage = controlledPerPage || searchParams.get('limit') || '24'

  // Helper to build category URL with optional variant slug (memoized)
  const buildCategoryUrl = useCallback(
    (urlKey: string) => {
      return buildCanonicalCategoryUrl(locale, {
        categoryUrlKey: urlKey,
        variantSlug
      })
    },
    [locale, variantSlug]
  )

  // Create a new URL with updated search params (memoized)
  const updateUrl = useCallback(
    (updates: Record<string, string | number | null>) => {
      const params = new URLSearchParams(searchParams.toString())

      // Update or remove params
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) {
          params.delete(key)
        } else {
          params.set(key, String(value))
        }
      })

      // Construct new URL
      const newUrl = `${pathname}?${params.toString()}`

      // Push updates
      router.push(newUrl, { scroll: false })
    },
    [pathname, searchParams, router]
  )

  const handlePageChange = useCallback(
    (page: number) => {
      if (onPageChange) {
        onPageChange(page)
      } else {
        // Fallback if no handler provided (likely handled by parent via URL params too)
        updateUrl({ page })
      }
    },
    [onPageChange, updateUrl]
  )

  const handleSortChange = useCallback(
    (value: string) => {
      if (onSortChange) {
        onSortChange(value as 'popularity' | 'price-asc' | 'price-desc' | 'name')
        return
      }

      updateUrl({ sort: value, page: 1 }) // Reset to page 1 on sort change
    },
    [onSortChange, updateUrl]
  )

  const handlePerPageChange = useCallback(
    (value: string) => {
      if (onPerPageChange) {
        onPerPageChange(value)
        return
      }

      updateUrl({ limit: value, page: 1 }) // Reset to page 1 on limit change
    },
    [onPerPageChange, updateUrl]
  )

  // Calculate start and end indices for display (memoized)
  const itemsPerPage = useMemo(() => parseInt(perPage), [perPage])
  const { startItem, endItem } = useMemo(
    () => ({
      startItem: Math.min((currentPage - 1) * itemsPerPage + 1, totalParts),
      endItem: Math.min(currentPage * itemsPerPage, totalParts)
    }),
    [currentPage, itemsPerPage, totalParts]
  )

  // For leaf categories, show product grid
  if (category.isLeaf) {
    return (
      <div className="flex-1">
        {/* Info message when vehicle is selected but no products found or filtering failed */}
        {hasVehicleSelected && !isLoading && (
          <Alert className="mb-6 bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-900">
              {t('vehicleNoProductsTitle')}
            </AlertTitle>
            <AlertDescription className="text-blue-800 mt-2">
              {t('vehicleNoProductsDescription')}
            </AlertDescription>
          </Alert>
        )}

        {/* Header with vehicle info and controls - hide if vehicle selected but no products */}
        {!hasVehicleSelected && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 pb-2.5">
          {/* Mobile Filter Button */}
          <MobileSidebarSheet
            facets={facets}
            selectedBrands={activeBrands}
            selectedCategories={[]}
            selectedStockStatuses={activeStockStatuses}
            onToggleFacet={(field: string, value: string) => {
              if (field === 'brandName') onBrandChange?.(value)
              if (
                field === 'stockStatus' &&
                (value === 'in-stock' || value === 'on-order')
              ) {
                onStockStatusChange?.(value)
              }
            }}
            onClearFilters={onClearFilters || (() => {})}
            isLoading={isLoading}
            extraSections={extraSidebarSections}
            title={getLocalizedCategoryName(category, locale)}
            activeFilterCount={activeFilterCount}
          />

          {/* Sorting and view controls */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* Sort dropdown */}
            <Select value={sortBy} onValueChange={handleSortChange}>
              <SelectTrigger className="h-8 w-[156px] rounded-sm border-slate-200 bg-white text-[13px]">
                <SelectValue placeholder={t('sortBy')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="popularity">{t('sortPopularity')}</SelectItem>
                <SelectItem value="price-asc">{t('sortPriceAsc')}</SelectItem>
                <SelectItem value="price-desc">{t('sortPriceDesc')}</SelectItem>
                <SelectItem value="name">{t('sortName')}</SelectItem>
              </SelectContent>
            </Select>

            {/* Per page dropdown */}
            <Select value={perPage} onValueChange={handlePerPageChange}>
              <SelectTrigger className="h-8 w-[68px] rounded-sm border-slate-200 bg-white text-[13px]">
                <SelectValue placeholder="24" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24</SelectItem>
                <SelectItem value="48">48</SelectItem>
                <SelectItem value="96">96</SelectItem>
              </SelectContent>
            </Select>

            {/* View mode toggle */}
            <div className="flex items-center overflow-hidden rounded-sm border border-slate-200 bg-white">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewMode('list')}
                className={`h-8 w-8 rounded-none ${
                  viewMode === 'list' ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <List className="w-4 h-4 text-slate-600" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setViewMode('grid')}
                className={`h-8 w-8 rounded-none ${
                  viewMode === 'grid' ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <Grid className="w-4 h-4 text-slate-600" />
              </Button>
            </div>

            {/* Results count and pagination */}
            <span className="min-w-[104px] text-right text-[11px] text-slate-600">
              {totalParts > 0
                ? t('resultsRange', {
                    start: startItem,
                    end: endItem,
                    total: totalParts
                  })
                : t('resultsZero')}
            </span>

            {/* Pagination arrows */}
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded-sm"
                disabled={currentPage === 1}
                onClick={() => handlePageChange(currentPage - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded-sm"
                disabled={currentPage === totalPages}
                onClick={() => handlePageChange(currentPage + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        )}

        {/* Product Grid */}
        {/* Don't show products if vehicle is selected but filtering failed or no products found */}
        {hasVehicleSelected ? (
          // Vehicle selected but no products or filtering failed - only show info message
          null
        ) : isLoading && parts.length === 0 ? (
          // Initial load - show spinner
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">{t('loading')}</p>
            </div>
          </div>
        ) : parts.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {parts.map((part) => (
                <GridProductCard
                  key={part.id}
                  id={part.id}
                  name={part.name}
                  sourceType={part.sourceType}
                  supplierProductId={part.supplierProductId}
                  brandName={part.brand.name}
                  brandLogo={part.brand.logoUrl}
                  categoryName={localizedCategoryName}
                  image={part.images[0]?.image}
                  thumb={part.images[0]?.thumb}
                  price={part.price}
                  priceSource={part.priceSource}
                  isPlaceholderPrice={part.isPlaceholderPrice}
                  isPurchasable={part.isPurchasable}
                  properties={part.properties}
                  eans={part.eans}
                  variantCount={part.variantCount}
                  isVehicleSpecific={!!variantSlug}
                  isBestseller={false}
                  stock={part.stock}
                  isPriceLoading={priceLoadingIds.has(part.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {parts.map((part) => (
                <ProductCard
                  key={part.id}
                  id={part.id}
                  name={part.name}
                  sourceType={part.sourceType}
                  supplierProductId={part.supplierProductId}
                  brandName={part.brand.name}
                  brandLogo={part.brand.logoUrl}
                  categoryName={localizedCategoryName}
                  image={part.images[0]?.image}
                  thumb={part.images[0]?.thumb}
                  price={part.price}
                  priceSource={part.priceSource}
                  isPlaceholderPrice={part.isPlaceholderPrice}
                  isPurchasable={part.isPurchasable}
                  properties={part.properties}
                  eans={part.eans}
                  variantCount={part.variantCount}
                  isVehicleSpecific={!!variantSlug}
                  isBestseller={false}
                  stock={part.stock}
                  isPriceLoading={priceLoadingIds.has(part.id)}
                />
              ))}
            </div>
          )
        ) : (
          // Only show empty state if vehicle is not selected or if vehicle is selected but we already showed the info message
          !hasVehicleSelected && (
            <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
              <Package className="h-16 w-16 text-slate-200" />
              <h3 className="mt-4 text-lg font-medium text-slate-900">
                {t('noProducts')}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {variantSlug ? t('tryDifferent') : t('tryDifferentFilters')}
              </p>
            </div>
          )
        )}

        {/* Pagination - hide if vehicle selected but no products */}
        {!hasVehicleSelected && (
          <div className="mt-8">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalParts}
              itemsPerPage={itemsPerPage}
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </div>
    )
  }

  // For category pages, show subcategory grid (icon + label cards)
  return (
    <div className="flex-1">
      <div className="mb-4 flex items-end justify-between gap-4 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {getLocalizedCategoryName(category, locale)}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t('subcategoriesFound', { count: visibleSubcategories.length })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 xl:gap-3.5">
        {visibleSubcategories
          .filter((sub) => sub.urlKey)
          .map((sub) => {
            const imgSrc = getCategoryImagePath(sub.image)
            const href = sub.urlKey ? buildCategoryUrl(sub.urlKey) : '#'
            return (
              <OptimizedCategoryLink
                key={sub.id}
                href={href}
                router={router}
                imgSrc={imgSrc}
                categoryName={getLocalizedCategoryName(sub, locale)}
              />
            )
          })}
      </div>

      {visibleSubcategories.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          {t('noSubcategories')}
        </div>
      )}
    </div>
  )
}

// Optimized category link with prefetching for instant navigation
function OptimizedCategoryLink({
  href,
  router,
  imgSrc,
  categoryName
}: {
  href: string
  router: ReturnType<typeof useRouter>
  imgSrc: string | null
  categoryName: string
}) {
  const prefetchedRef = useRef(false)
  const categoryPageNavigation = useCategoryPageNavigationOptional()
  const normalizedHref = href.replace(
    /^\/(tr|en)(?:\/\1)+(?=\/|$|\?)/,
    '/$1'
  )

  const prefetchLink = useCallback(() => {
    if (!prefetchedRef.current && normalizedHref) {
      router.prefetch(normalizedHref)
      void categoryPageNavigation?.prefetch(normalizedHref)
      prefetchedRef.current = true
    }
  }, [normalizedHref, router, categoryPageNavigation])

  useEffect(() => {
    prefetchedRef.current = false
  }, [normalizedHref])

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (categoryPageNavigation) {
      void categoryPageNavigation.navigate(normalizedHref)
    } else {
      router.push(normalizedHref)
    }
  }

  return (
    <a
      href={normalizedHref}
      onClick={handleClick}
      onMouseEnter={prefetchLink}
      onTouchStart={prefetchLink}
      onPointerDown={prefetchLink}
      className="group flex h-[148px] cursor-pointer flex-col items-center rounded-[8px] border border-[#dfe5eb] bg-white px-2.5 pb-2.5 pt-3 sm:h-[158px] sm:px-3 sm:pb-3 sm:pt-3.5 lg:h-[166px] lg:px-3.5"
    >
      <div className="mb-2 flex h-[64px] w-full shrink-0 items-center justify-center text-slate-400 sm:mb-2.5 sm:h-[72px] lg:h-[78px]">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={categoryName}
            width={104}
            height={78}
            sizes="(max-width: 640px) 40vw, (max-width: 1024px) 28vw, 180px"
            className="h-full max-h-[78px] w-auto object-contain sm:max-h-[84px] lg:max-h-[90px]"
            loading="lazy"
          />
        ) : (
          <Wrench className="h-9 w-9 sm:h-10 sm:w-10" strokeWidth={1.5} />
        )}
      </div>
      <h3 className="line-clamp-2 min-h-[34px] text-center text-[13px] font-medium leading-[1.3] text-[#1f2937] transition-colors group-hover:text-sky-600 sm:min-h-[38px] sm:text-[14px] lg:text-[14px]">
        {categoryName}
      </h3>
    </a>
  )
}
