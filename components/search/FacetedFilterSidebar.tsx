'use client'

/**
 * FacetedFilterSidebar
 *
 * Dynamic filter sidebar with checkbox groups.
 * Displays facet options with counts and supports multi-select.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FacetGroup, SearchFilters } from '@/lib/types/search'
import { useTranslations } from 'next-intl'

// ============================================================================
// Types
// ============================================================================

interface FacetedFilterSidebarProps {
  /** Facet groups to display */
  facets: FacetGroup[]
  /** Current filters */
  filters: SearchFilters
  /** Toggle facet selection */
  onToggleFacet: (field: string, value: string) => void
  /** Clear all filters */
  onClearFilters: () => void
  /** Loading state */
  isLoading?: boolean
  /** Additional className */
  className?: string
}

interface FacetGroupProps {
  group: FacetGroup
  selectedValues: string[]
  onToggle: (value: string) => void
  isLoading?: boolean
}

// ============================================================================
// FacetGroup Component
// ============================================================================

function FacetGroupSection({
  group,
  selectedValues,
  onToggle,
  isLoading
}: FacetGroupProps) {
  const t = useTranslations('FacetedFilterSidebar')
  const [isExpanded, setIsExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const INITIAL_SHOW_COUNT = 6
  const visibleOptions = showAll
    ? group.options
    : group.options.slice(0, INITIAL_SHOW_COUNT)
  const hasMore = group.options.length > INITIAL_SHOW_COUNT

  if (group.options.length === 0) {
    return null
  }

  return (
    <div className="border-b border-slate-100 pb-4 last:border-0">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between py-2 text-left"
      >
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-900">
          {group.label}
        </h3>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {/* Options */}
      {isExpanded && (
        <div className="mt-2 space-y-1">
          {visibleOptions.map((option) => {
            const isSelected = selectedValues.includes(option.value)

            return (
              <label
                key={option.value}
                className={cn(
                  'group flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors',
                  isSelected ? 'bg-slate-100' : 'hover:bg-slate-50',
                  isLoading && 'pointer-events-none opacity-50'
                )}
              >
                {/* Checkbox */}
                <div
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border transition-all',
                    isSelected
                      ? 'border-slate-900 bg-slate-900'
                      : 'border-slate-300 bg-white group-hover:border-slate-400'
                  )}
                >
                  {isSelected && (
                    <svg
                      className="h-3 w-3 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>

                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(option.value)}
                  className="hidden"
                />

                {/* Label & Count */}
                <span
                  className={cn(
                    'flex-1 text-sm',
                    isSelected
                      ? 'font-medium text-slate-900'
                      : 'text-slate-600 group-hover:text-slate-900'
                  )}
                >
                  {option.label}
                </span>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    isSelected ? 'text-slate-700' : 'text-slate-400'
                  )}
                >
                  ({option.count})
                </span>
              </label>
            )
          })}

          {/* Show More/Less */}
          {hasMore && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mt-2 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              {showAll
                ? t('showLess')
                : t('showMore', { count: group.options.length - INITIAL_SHOW_COUNT })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Active Filters
// ============================================================================

interface ActiveFiltersProps {
  filters: SearchFilters
  facets: FacetGroup[]
  onToggleFacet: (field: string, value: string) => void
  onClearFilters: () => void
}

function ActiveFilters({
  filters,
  facets,
  onToggleFacet,
  onClearFilters
}: ActiveFiltersProps) {
  const t = useTranslations('FacetedFilterSidebar')
  const hasActiveFilters =
    filters.brands.length > 0 || filters.categories.length > 0

  if (!hasActiveFilters) {
    return null
  }

  // Get label for a brand/category ID from facets
  const getLabel = (field: string, value: string): string => {
    const group = facets.find((f) => f.field === field)
    const option = group?.options.find((o) => o.value === value)
    return option?.label || value
  }

  return (
    <div className="mb-4 border-b border-slate-100 pb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {t('activeFilters')}
        </span>
        <button
          onClick={onClearFilters}
          className="text-xs text-red-500 hover:text-red-700"
        >
          {t('clearAll')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {filters.brands.map((brand) => (
          <span
            key={`brand-${brand}`}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
          >
            {getLabel('brandName', brand)}
            <button
              onClick={() => onToggleFacet('brandName', brand)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-slate-200"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {filters.categories.map((category) => (
          <span
            key={`category-${category}`}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
          >
            {getLabel('categoryName', category)}
            <button
              onClick={() => onToggleFacet('categoryName', category)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-slate-200"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function FacetedFilterSidebar({
  facets,
  filters,
  onToggleFacet,
  onClearFilters,
  isLoading = false,
  className
}: FacetedFilterSidebarProps) {
  const t = useTranslations('FacetedFilterSidebar')
  // Map filter arrays to selected values for each facet
  const getSelectedValues = (field: string): string[] => {
    if (field === 'brandName') {
      return filters.brands
    }
    if (field === 'categoryName') {
      return filters.categories
    }
    return []
  }

  return (
    <aside
      className={cn(
        'w-full space-y-4 rounded-lg bg-white p-4 shadow-sm md:w-64 lg:w-72',
        className
      )}
    >
      {/* Header */}
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-base font-bold text-slate-900">{t('filters')}</h2>
      </div>

      {/* Active Filters */}
      <ActiveFilters
        filters={filters}
        facets={facets}
        onToggleFacet={onToggleFacet}
        onClearFilters={onClearFilters}
      />

      {/* Facet Groups */}
      <div className="space-y-4">
        {facets.map((group) => (
          <FacetGroupSection
            key={group.field}
            group={group}
            selectedValues={getSelectedValues(group.field)}
            onToggle={(value) => onToggleFacet(group.field, value)}
            isLoading={isLoading}
          />
        ))}
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/50">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        </div>
      )}
    </aside>
  )
}

export default FacetedFilterSidebar
