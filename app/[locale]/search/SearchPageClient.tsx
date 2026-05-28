'use client'

/**
 * Search Page Client Component
 *
 * Faceted search page matching category page layout.
 * Uses Meilisearch for performance, CategoryContent-style UI.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useSearch } from '@/hooks/use-search'
import { useTranslations } from 'next-intl'
import {
  Grid,
  List,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  ChevronDown,
  Loader2,
  Package
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Pagination } from '@/components/ui/Pagination'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { ProductCard } from '@/app/[locale]/[...slug]/_components/ProductCard'
import { ProductCardSkeleton } from '@/app/[locale]/[...slug]/_components/ProductCardSkeleton'
import { GridProductCard } from '@/app/[locale]/[...slug]/_components/GridProductCard'
import { GridProductCardSkeleton } from '@/app/[locale]/[...slug]/_components/GridProductCardSkeleton'
import type {
  FacetGroup,
  SearchHit,
  SearchSort
} from '@/lib/types/search'
import { SearchSidebar } from '@/components/search/SearchSidebar'


// Convert SearchHit to ProductCard props
function mapHitToProductCardProps(hit: SearchHit) {
  return {
    id: parseInt(hit.id, 10),
    name: hit.name,
    sourceType: hit.sourceType,
    supplierProductId: hit.supplierProductId ?? null,
    brandName: hit.brandName,
    brandLogo: hit.brandLogo,
    categoryName: hit.categoryName,
    image: hit.images?.[0]?.image || null,
    thumb: hit.images?.[0]?.thumb || null,
    price: hit.price,
    priceSource: hit.priceSource,
    isPlaceholderPrice: hit.isPlaceholderPrice,
    isPurchasable: hit.isPurchasable,
    properties: [],
    eans: hit.oemCodes || [],
    isVehicleSpecific: hit.formattedCompatibility.length > 0,
    isBestseller: false,
    stock: hit.stockQty
  }
}

export default function SearchPageClient() {
  const t = useTranslations('CategoryPage')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const [perPage, setPerPage] = useState('24')

  const {
    filters,
    hits,
    totalHits,
    facets,
    isLoading,
    error,
    toggleFacet,
    clearFilters,
    setFilter
  } = useSearch()

  const activeFilterCount =
    filters.brands.length +
    filters.categories.length +
    (filters.minPrice != null ? 1 : 0) +
    (filters.maxPrice != null ? 1 : 0)
  const itemsPerPage = parseInt(perPage)
  const currentPage = filters.page
  const totalPages = Math.ceil(totalHits / itemsPerPage)
  const startItem = Math.min((currentPage - 1) * itemsPerPage + 1, totalHits)
  const endItem = Math.min(currentPage * itemsPerPage, totalHits)

  const handlePageChange = (page: number) => {
    setFilter('page', page)
  }

  return (
    <>
      {/* Breadcrumb */}
      <nav className="bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Ana Sayfa
            </Link>
            <ChevronRight size={14} className="text-muted-foreground" />
            <span className="text-foreground font-medium">Parça Ara</span>
            {filters.query && (
              <>
                <ChevronRight size={14} className="text-muted-foreground" />
                <span className="text-foreground">"{filters.query}"</span>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 pb-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <SearchSidebar
            facets={facets}
            selectedBrands={filters.brands}
            selectedCategories={filters.categories}
            onToggleFacet={toggleFacet}
            onClearFilters={clearFilters}
            isLoading={isLoading}
            minPrice={filters.minPrice}
            maxPrice={filters.maxPrice}
            onMinPriceChange={(v) => setFilter('minPrice', v)}
            onMaxPriceChange={(v) => setFilter('maxPrice', v)}
          />

          {/* Main Content */}
          <div className="flex-1">
            {/* Header with controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              {/* Mobile Filter Button */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    className="lg:hidden flex items-center gap-2"
                  >
                    <Filter size={18} />
                    <span>{t('filterBy')}</span>
                    {activeFilterCount > 0 && (
                      <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full min-w-[20px]">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[min(92vw,350px)] overflow-y-auto"
                >
                  <SheetHeader>
                    <SheetTitle>{t('filters')}</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    <SearchSidebar
                      facets={facets}
                      selectedBrands={filters.brands}
                      selectedCategories={filters.categories}
                      onToggleFacet={toggleFacet}
                      onClearFilters={clearFilters}
                      isLoading={isLoading}
                      minPrice={filters.minPrice}
                      maxPrice={filters.maxPrice}
                      onMinPriceChange={(v) => setFilter('minPrice', v)}
                      onMaxPriceChange={(v) => setFilter('maxPrice', v)}
                    />
                  </div>
                </SheetContent>
              </Sheet>

              {/* Sorting and view controls */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 lg:w-auto lg:ml-auto">
                {/* Sort dropdown — URL-synced */}
                <Select
                  value={filters.sort || 'popularity'}
                  onValueChange={(v) => setFilter('sort', v as SearchSort)}
                >
                  <SelectTrigger className="w-full sm:w-[180px] bg-background">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="popularity">Popularity</SelectItem>
                    <SelectItem value="price-asc">
                      Price: Low to High
                    </SelectItem>
                    <SelectItem value="price-desc">
                      Price: High to Low
                    </SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                  </SelectContent>
                </Select>

                {/* Per page dropdown */}
                <Select value={perPage} onValueChange={setPerPage}>
                  <SelectTrigger className="w-[88px] bg-background">
                    <SelectValue placeholder="24" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24</SelectItem>
                    <SelectItem value="48">48</SelectItem>
                    <SelectItem value="96">96</SelectItem>
                  </SelectContent>
                </Select>

                {/* View mode toggle */}
                <div className="flex items-center border border-input rounded-lg overflow-hidden bg-background">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode('list')}
                    className={`h-9 w-9 rounded-none ${
                      viewMode === 'list' ? 'bg-muted' : 'hover:bg-muted'
                    }`}
                  >
                    <List className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode('grid')}
                    className={`h-9 w-9 rounded-none ${
                      viewMode === 'grid' ? 'bg-muted' : 'hover:bg-muted'
                    }`}
                  >
                    <Grid className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>

                {/* Results count and pagination */}
                <span className="hidden sm:inline text-sm text-muted-foreground min-w-[100px] text-right">
                  {totalHits > 0
                    ? `${startItem} - ${endItem} of ${totalHits}`
                    : '0 results'}
                </span>

                {/* Pagination arrows */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage === 1 || isLoading}
                    onClick={() => handlePageChange(currentPage - 1)}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={currentPage >= totalPages || isLoading}
                    onClick={() => handlePageChange(currentPage + 1)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Error State */}
            {error && (
              <div className="mb-6 rounded-md border border-destructive/20 bg-destructive/10 p-4">
                <p className="text-sm text-destructive">
                  Arama sırasında bir hata oluştu. Lütfen tekrar deneyin.
                </p>
              </div>
            )}

            {/* Product Grid/List */}
            {isLoading && hits.length === 0 ? (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <GridProductCardSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <ProductCardSkeleton key={i} />
                  ))}
                </div>
              )
            ) : hits.length > 0 ? (
              viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {hits.map((hit) => (
                    <GridProductCard
                      key={hit.id}
                      {...mapHitToProductCardProps(hit)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {hits.map((hit) => (
                    <ProductCard
                      key={hit.id}
                      {...mapHitToProductCardProps(hit)}
                    />
                  ))}
                </div>
              )
            ) : (
              <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
                <Package className="h-16 w-16 text-primary-foreground/80" />
                <h3 className="mt-4 text-lg font-medium text-foreground">
                  Sonuç bulunamadı
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Farklı arama terimleri veya filtreler deneyin
                </p>
                <Button className="mt-4 bg-success text-success-foreground hover:bg-success/90" disabled>
                  Ürünü bulamadım
                </Button>
              </div>
            )}

            {/* Loading overlay */}
            {isLoading && hits.length > 0 && (
              <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50">
                <div className="bg-background/90 rounded-lg p-4 shadow-lg flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm text-foreground">Yükleniyor...</span>
                </div>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalHits}
                  itemsPerPage={itemsPerPage}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
