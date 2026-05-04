'use client'

import { useState } from 'react'
import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import type { BrandCount } from '@/lib/actions/getBrandsForCategory'
import { SidebarContainer } from '@/components/ui/sidebar-primitives'
import { CategoryNavigation } from '@/components/search/CategoryNavigation'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Menu } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { getLocalizedCategoryName } from '@/lib/utils/category-localization'

interface CategorySidebarProps {
  category: TrodoCategoryWithHierarchy
  variantSlug?: string
  navigationMode?: 'slug' | 'catalog-query'
  catalogPath?: string
  brands?: BrandCount[]
  activeBrands?: string[]
  onBrandChange?: (brandName: string, checked: boolean) => void
  inStock?: boolean
  onInStockChange?: (checked: boolean) => void
  activeFilterCount?: number
  onClearFilters?: () => void
}

export function CategorySidebar({
  category,
  variantSlug,
  navigationMode = 'catalog-query',
  catalogPath = '/catalog'
}: CategorySidebarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const locale = useLocale()
  const t = useTranslations('CatalogSection')

  return (
    <>
      <div className="rounded-[6px] border border-[#dfe5eb] bg-white p-2.5 lg:hidden">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setIsMenuOpen(true)}
            className="h-9 w-9 rounded-[6px] border-[#c4cdd5] text-[#212b36] hover:bg-[#f8f9f9]"
            aria-label={t('openMenu')}
          >
            <Menu size={18} />
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {t('sidebarTitle')}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {getLocalizedCategoryName(category, locale)}
            </p>
          </div>
        </div>
      </div>

      <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <SheetContent side="left" className="w-[min(88vw,302px)] p-0 lg:hidden">
          <SheetHeader className="border-b border-[#e7edf2] px-4 py-4 text-left">
            <SheetTitle className="text-[14px] font-semibold text-[#212b36]">
              {t('sidebarTitle')}
            </SheetTitle>
            <SheetDescription>{t('menuDescription')}</SheetDescription>
          </SheetHeader>

          <div className="px-3 pb-4 pt-3">
            <CategoryNavigation
              category={category}
              variantSlug={variantSlug}
              hideTitle={true}
              navigationMode={navigationMode}
              catalogPath={catalogPath}
              onNavigate={() => setIsMenuOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <SidebarContainer
        className="hidden rounded-[6px] border-[#dfe5eb] bg-white p-4 shadow-none lg:block lg:w-[302px]"
        contentClassName="pr-0"
      >
        <CategoryNavigation
          category={category}
          variantSlug={variantSlug}
          navigationMode={navigationMode}
          catalogPath={catalogPath}
        />
        {/* 
          Future: Add Filters here if needed for non-leaf pages 
          (e.g. Brand list if we decide to show facets on hub pages) 
        */}
      </SidebarContainer>
    </>
  )
}
