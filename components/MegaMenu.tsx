'use client'

import React, { useState, useEffect, useRef } from 'react'
import { ChevronRight, X, Wrench } from 'lucide-react'
import type { TrodoCategory } from '@/lib/actions/getPartCategories'
import { cn } from '@/lib/utils'
import { useRouter } from '@/lib/navigation'
import { useShop } from '@/components/ShopProvider'
import { useLocale } from 'next-intl'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import { buildCatalogPath } from '@/lib/catalog-url'
import Image from 'next/image'

interface MegaMenuProps {
  isOpen: boolean
  onClose: () => void
  activeCategorySlug: string | null
  triggerRef: React.RefObject<HTMLDivElement | null>
  categories: TrodoCategory[]
}

export const MegaMenu: React.FC<MegaMenuProps> = ({
  isOpen,
  onClose,
  activeCategorySlug,
  triggerRef,
  categories
}) => {
  const router = useRouter()
  const locale = useLocale()
  const { selectedVehicle } = useShop()
  const [selectedCategory, setSelectedCategory] =
    useState<TrodoCategory | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Helper to get localized category name
  const getCategoryName = (cat: TrodoCategory) => {
    if (locale === 'tr' && cat.nameTr) {
      return cat.nameTr
    }
    return cat.name
  }

  // Helper to build category URL in catalog shell
  const buildCategoryUrl = (urlKey: string) => {
    const variantSlug =
      (selectedVehicle as { urlKey?: string } | null)?.urlKey ?? null
    return buildCatalogPath({
      categoryUrlKey: urlKey,
      variantSlug
    })
  }

  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})

  const renderCategoryImage = (category: TrodoCategory, size: number) => {
    const imageSrc = getCategoryImagePath(category.image)

    if (imageSrc) {
      return (
        <Image
          src={imageSrc}
          alt={getCategoryName(category)}
          width={size}
          height={size}
          className="w-full h-full object-contain"
          loading="lazy"
          unoptimized
        />
      )
    }

    return <Wrench className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
  }

  // Check if this is a flat/simple mode (single category with subcategories shown directly)
  // Car parts (urlKey car-parts-1000000 or car-parts) uses two-panel; others use flat mode
  const isFlatMode = !(activeCategorySlug?.startsWith('car-parts') ?? false)
  const flatCategory =
    isFlatMode && categories.length > 0 ? categories[0] : null

  // Reset selected category when menu opens
  useEffect(() => {
    if (isOpen && categories.length > 0 && !isFlatMode) {
      setSelectedCategory(categories[0])
    }

    // Lock body scroll and calculate position
    if (isOpen) {
      document.body.style.overflow = 'hidden'

      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        // Make menu wider - use smaller margins
        const margin = Math.min(rect.left, 24) // Use at most 24px margin
        setMenuStyle({
          top: '120px',
          left: `${margin}px`,
          right: `${margin}px`
        })
      }
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen, categories, triggerRef, isFlatMode])

  if (!isOpen) return null

  const handleSubcategoryClick = (sub: TrodoCategory) => {
    if (!sub.urlKey) return
    router.push(buildCategoryUrl(sub.urlKey))
    onClose()
  }


  // Flat mode for Oils and Fluids - just show subcategories grid
  if (isFlatMode && flatCategory) {
    const subcategories = flatCategory.children || []

    return (
      <>
        {/* Dark backdrop overlay - starts below navbar */}
        <div
          className="fixed inset-0 bg-black/50 z-40"
          style={{ top: '120px' }}
          onClick={onClose}
        />

        {/* Mega Menu Panel - flat mode */}
        <div
          ref={menuRef}
          className="fixed bg-background border-b border-border shadow-lg z-50 max-h-[calc(100vh-120px)] overflow-y-auto rounded-b-lg"
          style={menuStyle}
        >
          <div className="p-5">
            {/* Header with close button */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-foreground">
                {getCategoryName(flatCategory)}
              </h3>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    if (!flatCategory.urlKey) return
                    router.push(buildCategoryUrl(flatCategory.urlKey))
                    onClose()
                  }}
                  className="text-sm text-primary hover:text-primary font-medium hover:underline"
                >
                  View all →
                </button>
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground transition-colors"
                  title="Kapat"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Subcategories Grid */}
            {subcategories.length > 0 ? (
              <div className="grid grid-cols-6 gap-4">
                {subcategories.map((sub) => (
                  <button
                    key={sub.id}
                    className="group flex flex-col items-center text-center p-2 rounded hover:bg-muted transition-colors"
                    onClick={() => handleSubcategoryClick(sub)}
                  >
                    {/* Subcategory Image */}
                    <div className="w-16 h-16 mb-2 flex items-center justify-center">
                      {renderCategoryImage(sub, 64)}
                    </div>
                    {/* Subcategory Name */}
                    <span className="text-xs text-foreground group-hover:text-foreground font-medium leading-tight line-clamp-2">
                      {getCategoryName(sub)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                No subcategories available
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // Standard mode for Car Parts - two-panel layout
  const subcategories = selectedCategory?.children || []

  return (
    <>
      {/* Dark backdrop overlay - starts below navbar */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        style={{ top: '120px' }}
        onClick={onClose}
      />

      {/* Mega Menu Panel - dynamic positioning */}
      <div
        ref={menuRef}
        className="fixed bg-background border-b border-border shadow-lg z-50 max-h-[calc(100vh-120px)] overflow-y-auto rounded-b-lg"
        style={menuStyle}
      >
        <div className="flex">
          {/* Left Panel - Categories List */}
          <div className="w-60 bg-muted border-r border-border shrink-0">
            <div className="max-h-[450px] overflow-y-auto py-1">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category)}
                  className={cn(
                    'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
                    selectedCategory?.id === category.id
                      ? 'bg-background text-primary font-medium'
                      : 'hover:bg-background text-foreground hover:text-foreground'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Category Icon/Image */}
                    <div className="w-6 h-6 flex items-center justify-center overflow-hidden">
                      {renderCategoryImage(category, 24)}
                    </div>
                    <span className="text-sm">{getCategoryName(category)}</span>
                  </div>
                  {category.children && category.children.length > 0 && (
                    <ChevronRight
                      size={14}
                      className={cn(
                        'shrink-0',
                        selectedCategory?.id === category.id
                          ? 'text-primary'
                          : 'text-muted-foreground/70'
                      )}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Right Panel - Subcategories Grid */}
          <div className="flex-1 bg-background min-h-[450px] max-h-[450px] overflow-y-auto">
            {selectedCategory && (
              <div className="p-5">
                {/* Header with close button */}
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-foreground">
                    {getCategoryName(selectedCategory)}
                  </h3>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => {
                        if (!selectedCategory.urlKey) return
                        router.push(buildCategoryUrl(selectedCategory.urlKey))
                        onClose()
                      }}
                      className="text-sm text-primary hover:text-primary font-medium hover:underline"
                    >
                      View all →
                    </button>
                    <button
                      onClick={onClose}
                      className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-muted-foreground transition-colors"
                      title="Kapat"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* Subcategories Grid */}
                {subcategories.length > 0 ? (
                  <div className="grid grid-cols-6 gap-4">
                    {subcategories.map((sub) => (
                      <button
                        key={sub.id}
                        className="group flex flex-col items-center text-center p-2 rounded hover:bg-muted transition-colors"
                        onClick={() => handleSubcategoryClick(sub)}
                      >
                        {/* Subcategory Image */}
                        <div className="w-16 h-16 mb-2 flex items-center justify-center">
                          {renderCategoryImage(sub, 64)}
                        </div>
                        {/* Subcategory Name */}
                        <span className="text-xs text-foreground group-hover:text-foreground font-medium leading-tight line-clamp-2">
                          {getCategoryName(sub)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-80 text-muted-foreground text-sm">
                    No subcategories available
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
