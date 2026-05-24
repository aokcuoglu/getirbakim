'use client'

import React from 'react'
import { CatalogButton } from './CatalogButton'
import { CategoryItem } from './CategoryItem'
import { SpecialOffersButton } from './SpecialOffersButton'
import type { PartCategory } from '@/lib/actions/getPartCategories'

interface NavbarCategoriesProps {
  categories: PartCategory[]
  isCatalogOpen: boolean
  setIsCatalogOpen: (open: boolean) => void
  hoveredCategorySlug: string | null
  activeCategoryUrlKey?: string | null
  onCategoryClick: (slug: string) => void
  onCategoryHover: (slug: string) => void
  closeDropdowns: () => void
  categoryTriggerRef: React.RefObject<HTMLDivElement | null>
}

export const NavbarCategories: React.FC<NavbarCategoriesProps> = ({
  categories,
  isCatalogOpen,
  setIsCatalogOpen,
  hoveredCategorySlug,
  activeCategoryUrlKey = null,
  onCategoryClick,
  onCategoryHover,
  closeDropdowns,
  categoryTriggerRef
}) => {
  return (
    <div className="hidden md:block border-t border-border bg-background h-[48px] relative z-10">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-full flex items-center gap-5">
        {/* Catalog Trigger */}
        <CatalogButton
          isCatalogOpen={isCatalogOpen}
          setIsCatalogOpen={setIsCatalogOpen}
          closeDropdowns={closeDropdowns}
        />

        {/* Categories Scroll */}
        <div
          ref={categoryTriggerRef}
          className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-5 h-full text-[13px] font-medium text-muted-foreground"
        >
          {(categories || []).map((cat) =>
            cat.urlKey ? (
              <CategoryItem
                key={cat.id}
                name={cat.name}
                urlKey={cat.urlKey}
                isActive={hoveredCategorySlug === cat.urlKey || activeCategoryUrlKey === cat.urlKey}
                onClick={onCategoryClick}
                onHover={onCategoryHover}
              />
            ) : null
          )}
          <SpecialOffersButton onClick={closeDropdowns} />
        </div>
      </div>
    </div>
  )
}
