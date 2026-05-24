'use client'

import { useState, useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { FacetGroup } from '@/lib/types/search'
import {
  SidebarContainer,
  SidebarHeader,
  SidebarSection,
  SidebarSearch,
  SidebarList
} from '@/components/ui/sidebar-primitives'

export interface SearchSidebarProps {
  facets: FacetGroup[]
  selectedBrands: string[]
  selectedCategories: string[]
  selectedStockStatuses?: string[]
  onToggleFacet: (field: string, value: string) => void
  onClearFilters: () => void
  isLoading: boolean
  extraSections?: React.ReactNode
  title?: string
  /** Fiyat aralığı */
  minPrice?: number
  maxPrice?: number
  onMinPriceChange?: (v: number | undefined) => void
  onMaxPriceChange?: (v: number | undefined) => void
}

const FACET_PREVIEW_LIMIT = 10

function getVisibleOptions<
  T extends { value: string }
>(
  options: T[],
  selectedValues: string[],
  expanded: boolean,
  query: string
): T[] {
  if (query.trim() || expanded || options.length <= FACET_PREVIEW_LIMIT) {
    return options
  }

  const selected = options.filter((option) =>
    selectedValues.includes(option.value)
  )
  const unselected = options.filter(
    (option) => !selectedValues.includes(option.value)
  )

  return [...selected, ...unselected.slice(0, FACET_PREVIEW_LIMIT - selected.length)]
}

/**
 * SearchSidebarContent contains the actual filter logic and UI.
 * It is used by both the Desktop Sidebar and the Mobile Sheet.
 */
export function SearchSidebarContent({
  facets,
  selectedBrands,
  selectedCategories,
  selectedStockStatuses = [],
  onToggleFacet,
  onClearFilters,
  isLoading,
  extraSections,
  title,
  minPrice,
  maxPrice,
  onMinPriceChange,
  onMaxPriceChange
}: SearchSidebarProps) {
  const t = useTranslations('CategoryPage')
  const [brandSearchQuery, setBrandSearchQuery] = useState('')
  const [categorySearchQuery, setCategorySearchQuery] = useState('')
  const [showAllBrands, setShowAllBrands] = useState(false)
  const [showAllCategories, setShowAllCategories] = useState(false)
  const [localMin, setLocalMin] = useState('')
  const [localMax, setLocalMax] = useState('')

  useEffect(() => {
    setLocalMin(minPrice != null ? String(minPrice) : '')
  }, [minPrice])
  useEffect(() => {
    setLocalMax(maxPrice != null ? String(maxPrice) : '')
  }, [maxPrice])

  const activeFilterCount =
    selectedBrands.length +
    selectedCategories.length +
    (minPrice != null ? 1 : 0) +
    (maxPrice != null ? 1 : 0)
  const brandFacet = facets.find((f) => f.field === 'brandName')
  const categoryFacet = facets.find((f) => f.field === 'categoryName')
  const stockFacet = facets.find((f) => f.field === 'stockStatus')

  const filteredBrands =
    brandFacet?.options.filter((o) =>
      o.label.toLowerCase().includes(brandSearchQuery.toLowerCase())
    ) || []

  const filteredCategories =
    categoryFacet?.options.filter((o) =>
      o.label.toLowerCase().includes(categorySearchQuery.toLowerCase())
    ) || []

  const visibleBrands = useMemo(
    () =>
      getVisibleOptions(
        filteredBrands,
        selectedBrands,
        showAllBrands,
        brandSearchQuery
      ),
    [filteredBrands, selectedBrands, showAllBrands, brandSearchQuery]
  )

  const visibleCategories = useMemo(
    () =>
      getVisibleOptions(
        filteredCategories,
        selectedCategories,
        showAllCategories,
        categorySearchQuery
      ),
    [
      filteredCategories,
      selectedCategories,
      showAllCategories,
      categorySearchQuery
    ]
  )

  const hiddenBrandCount = Math.max(filteredBrands.length - visibleBrands.length, 0)
  const hiddenCategoryCount = Math.max(
    filteredCategories.length - visibleCategories.length,
    0
  )
  const resolvedTitle = title ?? (extraSections ? '' : t('filters'))
  const showHeaderRow = Boolean(resolvedTitle) || activeFilterCount > 0

  return (
    <div className="flex flex-col">
      {showHeaderRow && (
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          {resolvedTitle ? (
            <SidebarHeader className="mb-0 min-w-0 flex-1 text-[14px] font-semibold text-foreground">
              {resolvedTitle}
            </SidebarHeader>
          ) : (
            <div />
          )}
          {activeFilterCount > 0 && (
            <button
              onClick={onClearFilters}
              className="flex shrink-0 items-center gap-2 rounded-[4px] bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-accent"
            >
              <span>{t('clearFilters')}</span>
              <span className="min-w-[18px] rounded-[4px] bg-muted-foreground px-1.5 py-0.5 text-center text-[10px] text-primary-foreground">
                {activeFilterCount}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Extra Sections (e.g. Subcategories navigation) */}
      {extraSections}

      <div className="space-y-5">
        {/* Stock Filter */}
        {stockFacet && stockFacet.options.length > 0 && (
          <SidebarSection title={t('stockStatus')} defaultOpen>
            <SidebarList className="max-h-none space-y-0.5 pr-1">
              {stockFacet.options.map((option) => (
                <label
                  key={option.value}
                  className="group flex min-h-[30px] cursor-pointer items-center gap-2.5 py-[5px]"
                >
                  <input
                    type="checkbox"
                    checked={selectedStockStatuses.includes(option.value)}
                    onChange={() => onToggleFacet('stockStatus', option.value)}
                    disabled={isLoading}
                    className="h-4 w-4 shrink-0 rounded border-input text-muted-foreground focus-visible:ring-ring/50 focus:ring-offset-0 disabled:opacity-50"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] transition-colors ${
                      selectedStockStatuses.includes(option.value)
                        ? 'font-medium text-foreground'
                        : 'text-foreground group-hover:text-foreground'
                    }`}
                  >
                    {option.value === 'in-stock'
                      ? t('inStock')
                      : option.value === 'on-order'
                        ? t('onOrder')
                        : option.label}
                  </span>
                  <span className="min-w-[24px] px-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                    {option.count}
                  </span>
                </label>
              ))}
            </SidebarList>
          </SidebarSection>
        )}

        {/* Fiyat aralığı (opsiyonel, sadece arama sayfasında) */}
        {onMinPriceChange != null && onMaxPriceChange != null && (
          <div>
            <h3 className="mb-3 ml-1 text-[14px] font-medium text-foreground">
              {t('priceRange')}
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder={t('minPrice')}
                  value={localMin}
                  onChange={(e) => setLocalMin(e.target.value)}
                  onBlur={() => {
                    const n = localMin === '' ? undefined : parseFloat(localMin)
                    onMinPriceChange(n != null && !isNaN(n) ? n : undefined)
                  }}
                  className="h-[38px] w-full rounded-md border border-input bg-background px-[10px] py-[6px] text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
                />
              </div>
              <span className="text-muted-foreground">-</span>
              <div className="relative flex-1">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder={t('maxPrice')}
                  value={localMax}
                  onChange={(e) => setLocalMax(e.target.value)}
                  onBlur={() => {
                    const n = localMax === '' ? undefined : parseFloat(localMax)
                    onMaxPriceChange(n != null && !isNaN(n) ? n : undefined)
                  }}
                  className="h-[38px] w-full rounded-md border border-input bg-background px-[10px] py-[6px] text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
                />
              </div>
            </div>
          </div>
        )}

        {/* Brand Filter */}
        {brandFacet && brandFacet.options.length > 0 && (
          <SidebarSection title={t('manufacturer')} defaultOpen>
            <SidebarSearch
              placeholder={t('searchBrand')}
              value={brandSearchQuery}
              onChange={setBrandSearchQuery}
              className="mb-2"
              inputClassName="h-[38px] rounded-md border-input bg-background pl-[35px] pr-[10px] text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50"
              iconClassName="left-[11px] text-muted-foreground"
            />

            <SidebarList className="space-y-0.5 pr-1">
              {visibleBrands.map((option) => (
                <label
                  key={option.value}
                  className="group flex min-h-[30px] cursor-pointer items-center gap-2.5 py-[5px]"
                >
                  <div className="relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selectedBrands.includes(option.value)}
                      onChange={() => onToggleFacet('brandName', option.value)}
                      disabled={isLoading}
                      className="h-4 w-4 shrink-0 rounded border-input text-muted-foreground focus-visible:ring-ring/50 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] transition-colors ${
                      selectedBrands.includes(option.value)
                        ? 'font-medium text-foreground'
                        : 'text-foreground group-hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="min-w-[24px] px-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                    {option.count}
                  </span>
                </label>
              ))}
              {hiddenBrandCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllBrands((value) => !value)}
                  className="pt-1 text-left text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showAllBrands
                    ? t('showLess')
                    : `${t('showAll')} (${hiddenBrandCount})`}
                </button>
              )}
            </SidebarList>
          </SidebarSection>
        )}

        {/* Category Filter */}
        {categoryFacet && categoryFacet.options.length > 0 && (
          <SidebarSection title={t('categories')} defaultOpen>
            <SidebarSearch
              placeholder={t('searchCategory')}
              value={categorySearchQuery}
              onChange={setCategorySearchQuery}
              className="mb-2"
              inputClassName="h-[38px] rounded-md border-input bg-background pl-[35px] pr-[10px] text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50"
              iconClassName="left-[11px] text-muted-foreground"
            />
            <SidebarList className="space-y-0.5 pr-1">
              {visibleCategories.map((option) => (
                <label
                  key={option.value}
                  className="group flex min-h-[30px] cursor-pointer items-center gap-2.5 py-[5px]"
                >
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(option.value)}
                    onChange={() => onToggleFacet('categoryName', option.value)}
                    disabled={isLoading}
                    className="h-4 w-4 shrink-0 rounded border-input text-muted-foreground focus-visible:ring-ring/50 focus:ring-offset-0 disabled:opacity-50"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] transition-colors ${
                      selectedCategories.includes(option.value)
                        ? 'font-medium text-foreground'
                        : 'text-foreground group-hover:text-foreground'
                    }`}
                  >
                    {option.label}
                  </span>
                  <span className="min-w-[24px] px-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                    {option.count}
                  </span>
                </label>
              ))}
              {hiddenCategoryCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllCategories((value) => !value)}
                  className="pt-1 text-left text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showAllCategories
                    ? t('showLess')
                    : `${t('showAll')} (${hiddenCategoryCount})`}
                </button>
              )}
              {filteredCategories.length === 0 &&
                categorySearchQuery.trim() && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    {t('noSubcategories')}
                  </p>
                )}
            </SidebarList>
          </SidebarSection>
        )}
      </div>
    </div>
  )
}

/**
 * Main SearchSidebar component for Desktop.
 * Wraps content in a sticky SidebarContainer.
 */
export function SearchSidebar(props: SearchSidebarProps) {
  return (
    <SidebarContainer
      className="rounded-md border-border bg-background p-4 shadow-none"
      contentClassName="pr-0"
    >
      <SearchSidebarContent {...props} />
    </SidebarContainer>
  )
}
