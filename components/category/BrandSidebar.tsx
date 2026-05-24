'use client'

import { useState, useMemo } from 'react'
import { Search, ChevronDown, ChevronUp, Check } from 'lucide-react'
import type { BrandInfo } from '@/lib/actions/filters'

interface BrandSidebarProps {
  brands: BrandInfo[]
  selectedBrands: number[]
  onBrandChange: (brandIds: number[]) => void
}

export function BrandSidebar({
  brands,
  selectedBrands,
  onBrandChange
}: BrandSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const INITIAL_SHOW_COUNT = 10

  const filteredBrands = useMemo(() => {
    if (!searchQuery) return brands
    const query = searchQuery.toLowerCase()
    return brands.filter((brand) => brand.name.toLowerCase().includes(query))
  }, [brands, searchQuery])

  const displayedBrands = showAll
    ? filteredBrands
    : filteredBrands.slice(0, INITIAL_SHOW_COUNT)

  const toggleBrand = (brandId: number) => {
    if (selectedBrands.includes(brandId)) {
      onBrandChange(selectedBrands.filter((id) => id !== brandId))
    } else {
      onBrandChange([...selectedBrands, brandId])
    }
  }

  const clearAllBrands = () => {
    onBrandChange([])
  }

  return (
    <div className="bg-background rounded-xl shadow-sm border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-foreground text-sm uppercase tracking-wider">
          Brands
        </h3>
        {selectedBrands.length > 0 && (
          <button
            onClick={clearAllBrands}
            className="text-xs text-primary hover:text-primary font-medium"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          placeholder="Search brands..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus-visible:ring-ring/50 focus:border-transparent transition-all"
        />
      </div>

      {/* Brand List */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {displayedBrands.map((brand) => {
          const isSelected = selectedBrands.includes(brand.id)
          return (
            <label
              key={brand.id}
              className="flex items-center gap-3 py-2 px-2 rounded-lg cursor-pointer hover:bg-muted transition-colors group"
            >
              {/* Checkbox */}
              <div
                className={`
                  w-5 h-5 rounded border-2 flex items-center justify-center transition-all
                  ${
                    isSelected
                      ? 'bg-primary border-primary'
                      : 'bg-background border-input group-hover:border-input'
                  }
                `}
              >
                {isSelected && <Check size={14} className="text-primary-foreground" />}
              </div>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleBrand(brand.id)}
                className="hidden"
              />

              {/* Brand Logo / Name */}
              <div className="flex-1 flex items-center justify-between">
                <span
                  className={`text-sm ${
                    isSelected
                      ? 'text-foreground font-medium'
                      : 'text-foreground group-hover:text-foreground'
                  }`}
                >
                  {brand.name}
                </span>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {brand.count}
                </span>
              </div>
            </label>
          )
        })}
      </div>

      {/* Show More / Less */}
      {filteredBrands.length > INITIAL_SHOW_COUNT && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-3 py-2 text-sm text-primary hover:text-primary font-medium flex items-center justify-center gap-1 transition-colors"
        >
          {showAll ? (
            <>
              Show less <ChevronUp size={16} />
            </>
          ) : (
            <>
              Show all ({filteredBrands.length}) <ChevronDown size={16} />
            </>
          )}
        </button>
      )}
    </div>
  )
}
