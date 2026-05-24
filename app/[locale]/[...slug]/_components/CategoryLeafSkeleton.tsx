'use client'

import { ProductGridSkeleton } from './ProductCardSkeleton'
import { GridProductGridSkeleton } from './GridProductCardSkeleton'
import { useState } from 'react'
import { List, Grid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslations } from 'next-intl'
import { SearchSidebarSkeleton } from '@/components/search/SearchSidebarSkeleton'
import { CategoryNavigation } from '@/components/search/CategoryNavigation'
import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'

interface CategoryLeafSkeletonProps {
  category: TrodoCategoryWithHierarchy
  variantSlug?: string
  navigationMode?: 'slug' | 'catalog-query'
  catalogPath?: string
}

export function CategoryLeafSkeleton({
  category,
  variantSlug,
  navigationMode = 'catalog-query',
  catalogPath = '/catalog'
}: CategoryLeafSkeletonProps) {
  const t = useTranslations('CategoryPage')
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('categoryViewMode') as 'list' | 'grid') || 'list'
    }
    return 'list'
  })

  const categoryExtraSections = (
    <CategoryNavigation
      category={category}
      variantSlug={variantSlug}
      hideTitle={true}
      navigationMode={navigationMode}
      catalogPath={catalogPath}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row gap-5 xl:gap-6">
        <SearchSidebarSkeleton extraSections={categoryExtraSections} />
        <div className="flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2.5 border-b border-border pb-2.5">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select defaultValue="popularity">
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
              <Select defaultValue="24">
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
                  className={`h-8 w-8 rounded-none ${viewMode === 'list' ? 'bg-muted' : 'hover:bg-muted'}`}
                >
                  <List className="w-4 h-4 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setViewMode('grid')}
                  className={`h-8 w-8 rounded-none ${viewMode === 'grid' ? 'bg-muted' : 'hover:bg-muted'}`}
                >
                  <Grid className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          </div>
          {viewMode === 'grid' ? (
            <GridProductGridSkeleton count={12} />
          ) : (
            <ProductGridSkeleton count={6} />
          )}
        </div>
      </div>
    </div>
  )
}