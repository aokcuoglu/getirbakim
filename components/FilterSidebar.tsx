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
        <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">
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
                    ? 'bg-slate-900 border-slate-900'
                    : 'bg-white border-slate-300 group-hover:border-slate-400'
                }
              `}
            >
              {filters.categoryId === 245 && (
                <div className="w-1.5 h-1.5 bg-white rounded-[1px]" />
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
                  ? 'text-slate-900 font-medium'
                  : 'text-slate-600 group-hover:text-slate-900'
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
                    ? 'bg-slate-900 border-slate-900'
                    : 'bg-white border-slate-300 group-hover:border-slate-400'
                }
              `}
              >
                {filters.category === cat && !filters.categoryId && (
                  <div className="w-1.5 h-1.5 bg-white rounded-[1px]" />
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
                    ? 'text-slate-900 font-medium'
                    : 'text-slate-600 group-hover:text-slate-900'
                }`}
              >
                {cat}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">
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
            className="w-full h-1 bg-slate-200 rounded-full appearance-none cursor-pointer accent-slate-900"
          />
          <div className="flex justify-between text-xs font-mono text-slate-500 mt-3">
            <span>$0</span>
            <span className="font-bold text-slate-900">
              ${filters.maxPrice}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FilterSidebar
