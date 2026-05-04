'use client'

import { useState, useMemo } from 'react'
import { Filter, Search, X, Check } from 'lucide-react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface Brand {
  id: number
  name: string
}

interface Category {
  id: number
  name: string
}

interface ProductsFilterProps {
  brands: Brand[]
  categories: Category[]
  initialBrandId?: number | null
  initialCategoryId?: number | null
  initialProviderId?: number | null
}

export function ProductsFilter({
  brands,
  categories,
  initialBrandId,
  initialCategoryId,
  initialProviderId
}: ProductsFilterProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [selectedBrand, setSelectedBrand] = useState<number | null>(
    initialBrandId ?? null
  )
  const [selectedCategory, setSelectedCategory] = useState<number | null>(
    initialCategoryId ?? null
  )
  const [selectedProvider, setSelectedProvider] = useState<number | null>(
    initialProviderId ?? null
  )
  const [isOpen, setIsOpen] = useState(false)

  // Search states
  const [categorySearch, setCategorySearch] = useState('')
  const [brandSearch, setBrandSearch] = useState('')

  const activeFilterCount =
    (selectedBrand ? 1 : 0) +
    (selectedCategory ? 1 : 0) +
    (selectedProvider ? 1 : 0)

  // Filtered lists based on search
  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories
    return categories.filter((cat) =>
      cat.name.toLowerCase().includes(categorySearch.toLowerCase())
    )
  }, [categories, categorySearch])

  const filteredBrands = useMemo(() => {
    if (!brandSearch.trim()) return brands
    return brands.filter((brand) =>
      brand.name.toLowerCase().includes(brandSearch.toLowerCase())
    )
  }, [brands, brandSearch])

  // Get selected names for display
  const selectedCategoryName = categories.find(
    (c) => c.id === selectedCategory
  )?.name
  const selectedBrandName = brands.find((b) => b.id === selectedBrand)?.name

  const applyFilters = () => {
    const params = new URLSearchParams(searchParams.toString())

    if (selectedBrand) {
      params.set('brand', selectedBrand.toString())
    } else {
      params.delete('brand')
    }

    if (selectedCategory) {
      params.set('category', selectedCategory.toString())
    } else {
      params.delete('category')
    }

    if (selectedProvider) {
      params.set('provider', selectedProvider.toString())
    } else {
      params.delete('provider')
    }

    // Reset to page 1 when filters change
    params.delete('page')

    router.push(`${pathname}?${params.toString()}`)
    setIsOpen(false)
  }

  const clearFilters = () => {
    setSelectedBrand(null)
    setSelectedCategory(null)
    setSelectedProvider(null)
    setCategorySearch('')
    setBrandSearch('')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('brand')
    params.delete('category')
    params.delete('provider')
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
    setIsOpen(false)
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 relative">
          <Filter size={14} />
          <span>Filter</span>
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[320px] sm:w-[400px] flex flex-col"
      >
        <SheetHeader>
          <SheetTitle>Filter Products</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto mt-6 space-y-6 pb-20">
          {/* Category Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Category
              {selectedCategoryName && (
                <span className="ml-2 text-emerald-600 font-normal">
                  ({selectedCategoryName})
                </span>
              )}
            </label>
            {/* Search input */}
            <div className="relative mb-2">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search categories..."
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            {/* Category list */}
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
              <div
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 flex items-center justify-between ${
                  !selectedCategory ? 'bg-emerald-50 text-emerald-700' : ''
                }`}
              >
                <span>All Categories</span>
                {!selectedCategory && (
                  <Check size={14} className="text-emerald-600" />
                )}
              </div>
              {filteredCategories.map((cat) => (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 flex items-center justify-between ${
                    selectedCategory === cat.id
                      ? 'bg-emerald-50 text-emerald-700'
                      : ''
                  }`}
                >
                  <span>{cat.name}</span>
                  {selectedCategory === cat.id && (
                    <Check size={14} className="text-emerald-600" />
                  )}
                </div>
              ))}
              {filteredCategories.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-400 text-center">
                  No categories found
                </div>
              )}
            </div>
          </div>

          {/* Brand Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Brand
              {selectedBrandName && (
                <span className="ml-2 text-emerald-600 font-normal">
                  ({selectedBrandName})
                </span>
              )}
            </label>
            {/* Search input */}
            <div className="relative mb-2">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search brands..."
                value={brandSearch}
                onChange={(e) => setBrandSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            {/* Brand list */}
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
              <div
                onClick={() => setSelectedBrand(null)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 flex items-center justify-between ${
                  !selectedBrand ? 'bg-emerald-50 text-emerald-700' : ''
                }`}
              >
                <span>All Brands</span>
                {!selectedBrand && (
                  <Check size={14} className="text-emerald-600" />
                )}
              </div>
              {filteredBrands.map((brand) => (
                <div
                  key={brand.id}
                  onClick={() => setSelectedBrand(brand.id)}
                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 flex items-center justify-between ${
                    selectedBrand === brand.id
                      ? 'bg-emerald-50 text-emerald-700'
                      : ''
                  }`}
                >
                  <span>{brand.name}</span>
                  {selectedBrand === brand.id && (
                    <Check size={14} className="text-emerald-600" />
                  )}
                </div>
              ))}
              {filteredBrands.length === 0 && (
                <div className="px-3 py-4 text-sm text-gray-400 text-center">
                  No brands found
                </div>
              )}
            </div>
          </div>

          {/* Provider Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Provider
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedProvider === 1}
                  onChange={(e) =>
                    setSelectedProvider(e.target.checked ? 1 : null)
                  }
                  className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm text-gray-600">Dinamik</span>
              </label>
            </div>
          </div>

          {/* Stock Status Filter */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Stock Status
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm text-gray-600">In Stock</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm text-gray-600">Out of Stock</span>
              </label>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-100 bg-white flex gap-3">
          <Button variant="outline" onClick={clearFilters} className="flex-1">
            Clear All
          </Button>
          <Button
            onClick={applyFilters}
            className="flex-1 bg-[#101828] hover:bg-[#1d2939]"
          >
            Apply Filters
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
