'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  ChevronLeft,
  ChevronRight,
  Grid,
  List,
  Package
} from 'lucide-react'
import { ProductCard } from '@/app/[locale]/[...slug]/_components/ProductCard'
import { GridProductCard } from '@/app/[locale]/[...slug]/_components/GridProductCard'
import { SearchSidebar } from '@/components/search/SearchSidebar'
import { MobileSidebarSheet } from '@/components/search/MobileSidebarSheet'
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
  buildBrandPageHref,
  type BrandPageFilters,
  type BrandPageSort,
  type BrandPageStockStatus
} from '@/lib/v0/brandPageFilters'
import { mapSearchHitToProductCardProps } from '@/lib/v0/mapSearchHitToProductCard'
import type { FacetGroup } from '@/lib/types/search'
import type { SearchHit } from '@/lib/types/search'
import type { V0BrandMatchRow } from '@/lib/v0/types'

interface BrandProductsClientWrapperProps {
  brand: V0BrandMatchRow
  locale: string
  filters: BrandPageFilters
  products: SearchHit[]
  totalCount: number
  totalPages: number
  stockFacetDistribution: { 'in-stock': number; 'on-order': number }
}

function buildStockFacets(
  distribution: { 'in-stock': number; 'on-order': number },
  selectedStock: BrandPageStockStatus[]
): FacetGroup[] {
  return [
    {
      field: 'stockStatus',
      label: 'Stok durumu',
      options: [
        {
          value: 'in-stock',
          label: 'In stock',
          count: distribution['in-stock'] || 0,
          isSelected: selectedStock.includes('in-stock')
        },
        {
          value: 'on-order',
          label: 'On order',
          count: distribution['on-order'] || 0,
          isSelected: selectedStock.includes('on-order')
        }
      ]
    }
  ]
}

export function BrandProductsClientWrapper({
  brand,
  locale,
  filters,
  products,
  totalCount,
  totalPages,
  stockFacetDistribution
}: BrandProductsClientWrapperProps) {
  const router = useRouter()
  const t = useTranslations('CategoryPage')

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

  const facets = useMemo(
    () => buildStockFacets(stockFacetDistribution, filters.stock),
    [stockFacetDistribution, filters.stock]
  )

  const activeFilterCount =
    filters.stock.length +
    (filters.minPrice != null ? 1 : 0) +
    (filters.maxPrice != null ? 1 : 0)

  const navigateWithFilters = useCallback(
    (updates: Partial<BrandPageFilters>) => {
      const nextFilters: BrandPageFilters = {
        ...filters,
        ...updates
      }

      if (nextFilters.page < 1) {
        nextFilters.page = 1
      }

      router.push(buildBrandPageHref(locale, brand.matchId, nextFilters), {
        scroll: false
      })
    },
    [brand.matchId, filters, locale, router]
  )

  const handleToggleFacet = (field: string, value: string) => {
    if (field !== 'stockStatus') return
    if (value !== 'in-stock' && value !== 'on-order') return

    const nextStock = filters.stock.includes(value)
      ? filters.stock.filter((status) => status !== value)
      : [...filters.stock, value as BrandPageStockStatus]

    navigateWithFilters({ stock: nextStock, page: 1 })
  }

  const handleClearFilters = () => {
    navigateWithFilters({
      stock: [],
      minPrice: undefined,
      maxPrice: undefined,
      page: 1
    })
  }

  const itemsPerPage = filters.limit
  const startItem = Math.min((filters.page - 1) * itemsPerPage + 1, totalCount)
  const endItem = Math.min(filters.page * itemsPerPage, totalCount)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row gap-5 xl:gap-6">
        <SearchSidebar
          facets={facets}
          selectedBrands={[]}
          selectedCategories={[]}
          selectedStockStatuses={filters.stock}
          onToggleFacet={handleToggleFacet}
          onClearFilters={handleClearFilters}
          isLoading={false}
          minPrice={filters.minPrice}
          maxPrice={filters.maxPrice}
          onMinPriceChange={(value) =>
            navigateWithFilters({ minPrice: value, page: 1 })
          }
          onMaxPriceChange={(value) =>
            navigateWithFilters({ maxPrice: value, page: 1 })
          }
        />

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-border pb-2.5">
            <MobileSidebarSheet
              facets={facets}
              selectedBrands={[]}
              selectedCategories={[]}
              selectedStockStatuses={filters.stock}
              onToggleFacet={handleToggleFacet}
              onClearFilters={handleClearFilters}
              isLoading={false}
              minPrice={filters.minPrice}
              maxPrice={filters.maxPrice}
              onMinPriceChange={(value) =>
                navigateWithFilters({ minPrice: value, page: 1 })
              }
              onMaxPriceChange={(value) =>
                navigateWithFilters({ maxPrice: value, page: 1 })
              }
              title={brand.brandName}
              activeFilterCount={activeFilterCount}
            />

                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  <Select
                    value={filters.sort}
                    onValueChange={(value) =>
                      navigateWithFilters({ sort: value as BrandPageSort, page: 1 })
                    }
                  >
                    <SelectTrigger className="h-8 w-[156px] rounded-sm border-border bg-background text-[13px]">
                      <SelectValue placeholder={t('sortBy')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="popularity">{t('sortPopularity')}</SelectItem>
                      <SelectItem value="price-asc">{t('sortPriceAsc')}</SelectItem>
                      <SelectItem value="price-desc">{t('sortPriceDesc')}</SelectItem>
                      <SelectItem value="name">{t('sortName')}</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={String(filters.limit)}
                    onValueChange={(value) =>
                      navigateWithFilters({ limit: Number.parseInt(value, 10), page: 1 })
                    }
                  >
                    <SelectTrigger className="h-8 w-[68px] rounded-sm border-border bg-background text-[13px]">
                      <SelectValue placeholder="24" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="48">48</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="flex items-center overflow-hidden rounded-sm border border-border bg-background">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setViewMode('list')}
                      className={`h-8 w-8 rounded-none ${
                        viewMode === 'list' ? 'bg-muted' : 'hover:bg-muted'
                      }`}
                    >
                      <List className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setViewMode('grid')}
                      className={`h-8 w-8 rounded-none ${
                        viewMode === 'grid' ? 'bg-muted' : 'hover:bg-muted'
                      }`}
                    >
                      <Grid className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>

                  <span className="min-w-[104px] text-right text-[11px] text-muted-foreground">
                    {totalCount > 0
                      ? t('resultsRange', {
                          start: startItem,
                          end: endItem,
                          total: totalCount
                        })
                      : t('resultsZero')}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 rounded-sm"
                      disabled={filters.page <= 1}
                      onClick={() => navigateWithFilters({ page: filters.page - 1 })}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 rounded-sm"
                      disabled={filters.page >= totalPages}
                      onClick={() => navigateWithFilters({ page: filters.page + 1 })}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {products.length > 0 ? (
                viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {products.map((product, index) => (
                      <GridProductCard
                        key={product.id}
                        {...mapSearchHitToProductCardProps(product)}
                        brandLogo={brand.logoUrl}
                        isFirst={index === 0}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-col gap-3">
                    {products.map((product, index) => (
                      <ProductCard
                        key={product.id}
                        {...mapSearchHitToProductCardProps(product)}
                        brandLogo={brand.logoUrl}
                        isFirst={index === 0}
                      />
                    ))}
                  </div>
                )
              ) : (
                <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
                  <Package className="h-16 w-16 text-primary-foreground/80" />
                  <h3 className="mt-4 text-lg font-medium text-foreground">
                    {t('noProducts')}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('tryDifferentFilters')}
                  </p>
                </div>
              )}

              {products.length > 0 && (
                <div className="mt-8">
                  <Pagination
                    currentPage={filters.page}
                    totalPages={totalPages}
                    totalItems={totalCount}
                    itemsPerPage={itemsPerPage}
                    onPageChange={(page) => navigateWithFilters({ page })}
                  />
                </div>
              )}
            </div>
          </div>
    </div>
  )
}
