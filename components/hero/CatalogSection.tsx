'use client'

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogData } from '@/lib/actions/getCatalogCategories'
import { getCategoryImagePath } from '@/lib/utils/category-image'
import Image from 'next/image'
import { Menu, Search, Wrench } from 'lucide-react'
import { buildCatalogUrl } from '@/lib/catalog-url'
import { useShop } from '@/components/ShopProvider'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { useCategoryPageNavigationOptional } from '@/app/[locale]/[...slug]/_components/CategoryPageNavigationContext'

interface CatalogSectionProps {
  catalogData: CatalogData
}

export function CatalogSection({ catalogData }: CatalogSectionProps) {
  const router = useRouter()
  const { selectedVehicle } = useShop()
  const locale = useLocale()
  const t = useTranslations('CatalogSection')
  const { tabs, childrenByParent } = catalogData
  const selectedVehicleUrlKey = selectedVehicle?.urlKey ?? null

  // Default to first tab if available
  const [activeTabId, setActiveTabId] = useState<number | null>(
    tabs.length > 0 ? tabs[0].id : null
  )
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Get subcategories for the active tab
  const subcategories = useMemo(() => {
    if (activeTabId === null) return []
    return childrenByParent[activeTabId] || []
  }, [activeTabId, childrenByParent])
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs]
  )

  if (tabs.length === 0) {
    return null
  }

  const getReadableLabel = (name: string): string => {
    const normalized = name.toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US')
    const isWiperEquipment =
      (normalized.includes('silecek') || normalized.includes('wiper')) &&
      (normalized.includes('ekipman') || normalized.includes('equipment'))

    if (isWiperEquipment) {
      return t('shortWipers')
    }

    return name
  }

  const filteredTabs = useMemo(() => {
    const query = searchTerm
      .toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US')
      .trim()

    if (!query) return tabs

    return tabs.filter((tab) =>
      getReadableLabel(tab.name)
        .toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US')
        .includes(query)
    )
  }, [searchTerm, tabs, locale])

  const handleTabChange = (tabId: number) => {
    setActiveTabId(tabId)
  }

  const toCanonicalCategoryKey = (urlKey: string | null | undefined): string => {
    const normalized = (urlKey || '').trim().toLowerCase()
    if (!normalized) return 'car-parts'
    return normalized.replace(/-\d{5,}$/, '')
  }

  return (
    <section className="bg-background py-4 scroll-mt-24 sm:py-5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="mb-3 rounded-[10px] border border-border bg-background p-2.5 lg:hidden">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsMenuOpen(true)}
              className="h-9 w-9"
              aria-label={t('openMenu')}
            >
              <Menu size={18} />
            </Button>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {t('sidebarTitle')}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {activeTab ? getReadableLabel(activeTab.name) : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-3 flex gap-4 overflow-x-auto border-b border-border lg:hidden">
          {tabs.map((tab) => (
            <button
              key={`mobile-tab-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              className={`shrink-0 border-b-2 pb-2 text-[14px] font-medium leading-5 transition-colors ${
                activeTabId === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {getReadableLabel(tab.name)}
            </button>
          ))}
        </div>

        <Sheet open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <SheetContent side="left" className="w-[min(88vw,320px)] p-0 lg:hidden">
            <SheetHeader className="border-b border-border px-4 py-4 text-left">
              <SheetTitle>{t('sidebarTitle')}</SheetTitle>
              <SheetDescription>{t('menuDescription')}</SheetDescription>
            </SheetHeader>

            <div className="space-y-2 px-2 pb-4">
              <div className="px-2 pt-2">
                <div className="relative">
                  <Search
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="border-border bg-muted pl-9 text-sm"
                  />
                </div>
              </div>

              {filteredTabs.length > 0 ? (
                <div className="max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                  <div className="space-y-1">
                    {filteredTabs.map((tab) => {
                      const isActive = activeTabId === tab.id
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            handleTabChange(tab.id)
                            setIsMenuOpen(false)
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                            isActive
                              ? 'bg-primary text-primary-foreground'
                              : 'text-foreground hover:bg-muted'
                          }`}
                        >
                          <span className="truncate font-medium">
                            {getReadableLabel(tab.name)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <p className="px-2 text-sm text-muted-foreground">{t('noMatchingCategories')}</p>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Tab navigation */}
        <div className="mb-4 hidden border-b border-border lg:block">
          <div className="flex gap-6 overflow-x-auto pb-2.5 scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap border-b-2 pb-2 text-[16px] font-medium leading-5 transition-colors ${
                  activeTabId === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {getReadableLabel(tab.name)}
              </button>
            ))}
          </div>
        </div>

        {/* Category grid */}
        {subcategories.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {subcategories.map((cat) => (
              <OptimizedCatalogLink
                key={cat.id}
                href={buildCatalogUrl(locale, {
                  categoryUrlKey: toCanonicalCategoryKey(cat.urlKey),
                  variantSlug: selectedVehicleUrlKey
                })}
                router={router}
                image={cat.image}
                name={cat.name}
                displayName={getReadableLabel(cat.name)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            {t('noSubcategories')}
          </div>
        )}
      </div>
    </section>
  )
}

// Optimized catalog link with prefetching
function OptimizedCatalogLink({
  href,
  router,
  image,
  name,
  displayName
}: {
  href: string
  router: ReturnType<typeof useRouter>
  image: string | null
  name: string
  displayName: string
}) {
  const prefetchedRef = useRef(false)
  const imgSrc = getCategoryImagePath(image)
  const categoryPageNavigation = useCategoryPageNavigationOptional()
  const normalizedHref = href.replace(
    /^\/(tr|en)(?:\/\1)+(?=\/|$|\?)/,
    '/$1'
  )

  const prefetchLink = useCallback(() => {
    if (!prefetchedRef.current && normalizedHref) {
      router.prefetch(normalizedHref)
      void categoryPageNavigation?.prefetch(normalizedHref)
      prefetchedRef.current = true
    }
  }, [normalizedHref, router, categoryPageNavigation])

  useEffect(() => {
    prefetchedRef.current = false
  }, [normalizedHref])

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    if (categoryPageNavigation) {
      void categoryPageNavigation.navigate(normalizedHref)
    } else {
      router.push(normalizedHref)
    }
  }

  return (
    <a
      href={normalizedHref}
      onClick={handleClick}
      onMouseEnter={prefetchLink}
      onTouchStart={prefetchLink}
      onPointerDown={prefetchLink}
      className="group flex min-h-[148px] flex-col items-center justify-center rounded-md border border-border bg-background px-4 py-4 sm:min-h-[162px] sm:px-5 sm:py-5 lg:min-h-[182px] lg:px-6 lg:py-6"
    >
      <div className="flex h-[72px] w-full shrink-0 items-center justify-center text-muted-foreground sm:h-[82px] lg:h-[92px]">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={name}
            width={150}
            height={98}
            sizes="(max-width: 768px) 35vw, (max-width: 1200px) 20vw, 180px"
            className="h-full max-h-[86px] w-auto object-contain lg:max-h-[98px]"
            loading="lazy"
          />
        ) : (
          <Wrench className="h-9 w-9" strokeWidth={1.5} />
        )}
      </div>
      <h3
        className="mt-3 min-h-[40px] text-center text-[14px] font-medium leading-5 text-foreground transition-colors line-clamp-2 group-hover:text-primary"
        title={name}
      >
        {displayName}
      </h3>
    </a>
  )
}
