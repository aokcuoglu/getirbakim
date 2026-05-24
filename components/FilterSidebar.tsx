import React from 'react'
import { Category, FilterState } from '../types'

interface FilterSidebarProps {
  filters: FilterState
  onFilterChange: (newFilters: FilterState) => void
}

const FilterSidebar: React.FC<FilterSidebarProps> = ({
  filters,
  onFilterChange
}) => {
  const categories = ['All', ...Object.values(Category)]

  return (
    <div className="w-full md:w-64 space-y-8">
      <div>
        <h3 className="font-bold text-foreground text-sm uppercase tracking-wider mb-4 border-b border-border pb-2">
          Categories
        </h3>
        <div className="space-y-2">
          {/* Custom Hydraulic Filters Item */}
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              className={`
                w-4 h-4 rounded border flex items-center justify-center transition-all
                ${
                  filters.categoryId === 245
                    ? 'bg-primary border-primary'
                    : 'bg-background border-input group-hover:border-input'
                }
              `}
            >
              {filters.categoryId === 245 && (
                <div className="w-1.5 h-1.5 bg-background rounded-[1px]" />
              )}
            </div>
            <input
              type="radio"
              name="category"
              checked={filters.categoryId === 245}
              onChange={() =>
                onFilterChange({
                  ...filters,
                  category: Category.Filters,
                  categoryId: 245
                })
              }
              className="hidden"
            />
            <span
              className={`text-sm ${
                filters.categoryId === 245
                  ? 'text-foreground font-medium'
                  : 'text-muted-foreground group-hover:text-foreground'
              }`}
            >
              Hydraulic filters
            </span>
          </label>

          {categories.map((cat) => (
            <label
              key={cat}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <div
                className={`
                w-4 h-4 rounded border flex items-center justify-center transition-all
                ${
                  filters.category === cat && !filters.categoryId
                    ? 'bg-primary border-primary'
                    : 'bg-background border-input group-hover:border-input'
                }
              `}
              >
                {filters.category === cat && !filters.categoryId && (
                  <div className="w-1.5 h-1.5 bg-background rounded-[1px]" />
                )}
              </div>
              <input
                type="radio"
                name="category"
                checked={filters.category === cat && !filters.categoryId}
                onChange={() =>
                  onFilterChange({
                    ...filters,
                    category: cat as Category | 'All',
                    categoryId: undefined
                  })
                }
                className="hidden"
              />
              <span
                className={`text-sm ${
                  filters.category === cat && !filters.categoryId
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground group-hover:text-foreground'
                }`}
              >
                {cat}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-bold text-foreground text-sm uppercase tracking-wider mb-4 border-b border-border pb-2">
          Max Price
        </h3>
        <div className="px-1">
          <input
            type="range"
            min="0"
            max="200"
            value={filters.maxPrice}
            onChange={(e) =>
              onFilterChange({ ...filters, maxPrice: parseInt(e.target.value) })
            }
            className="w-full h-1 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
          />
          <div className="flex justify-between text-xs font-mono text-muted-foreground mt-3">
            <span>$0</span>
            <span className="font-bold text-foreground">
              ${filters.maxPrice}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FilterSidebar
