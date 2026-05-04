'use client'

import React from 'react'
import { ChevronRight } from 'lucide-react'
import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import { useTranslations, useLocale } from 'next-intl'
import { getLocalizedCategoryName } from '@/lib/utils/category-localization'
import { useShop } from '@/components/ShopProvider'
import { useRouter } from 'next/navigation'
import { buildCategoryUrl } from '@/lib/catalog-url'
import { useCategoryPageNavigationOptional } from './CategoryPageNavigationContext'

interface VehicleInfo {
  make: string
  model: string
  variant: string
  fuel: string
  kwPs: string
}

interface BreadcrumbSectionProps {
  category: TrodoCategoryWithHierarchy
  vehicleInfo?: VehicleInfo
  variantSlug?: string
  extraCrumb?: string
  showIntro?: boolean
}

export function BreadcrumbSection({
  category,
  vehicleInfo,
  variantSlug,
  extraCrumb,
  showIntro = true
}: BreadcrumbSectionProps) {
  const t = useTranslations('Part')
  const tNavbar = useTranslations('Navbar')
  const locale = useLocale()
  const router = useRouter()
  const categoryPageNavigation = useCategoryPageNavigationOptional()
  const { clearSelectedVehicle } = useShop()

  // Format vehicle info string
  const vehicleString = vehicleInfo
    ? `${vehicleInfo.make} ${vehicleInfo.model} ${vehicleInfo.fuel} ${vehicleInfo.variant} ${vehicleInfo.kwPs}`
    : null
  const categoryName = getLocalizedCategoryName(category, locale)
  const introText =
    locale === 'tr'
      ? `${categoryName} kategorisinde aracina uygun urunleri kolayca bul. Alt kategorilerde hizli gezin, marka ve urunleri tek ekranda karsilastir.`
      : `Find the right parts in ${categoryName} quickly. Browse subcategories instantly and compare brands and products on one page.`

  const getCatalogHref = React.useCallback(
    (urlKey: string | null | undefined, variant?: string) =>
      buildCategoryUrl(locale, {
        categoryUrlKey: urlKey ?? 'car-parts',
        variantSlug: variant ?? variantSlug ?? null
      }),
    [locale, variantSlug]
  )

  const prefetchHref = React.useCallback(
    (href: string) => {
      router.prefetch(href)
      void categoryPageNavigation?.prefetch(href)
    },
    [router, categoryPageNavigation]
  )

  const handleCategoryLinkClick = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      event.preventDefault()

      if (href === '/') {
        router.push('/')
        return
      }

      if (categoryPageNavigation) {
        void categoryPageNavigation.navigate(href)
        return
      }

      router.push(href)
    },
    [categoryPageNavigation, router]
  )

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-3 pb-2">
      {/* breadcrumb trail */}
      <nav className="mb-2 flex items-center gap-2 text-[13px] text-slate-500">
        <a
          href="/"
          onMouseEnter={() => prefetchHref('/')}
          onFocus={() => prefetchHref('/')}
          onClick={(event) => handleCategoryLinkClick(event, '/')}
          className="transition-colors hover:text-slate-900"
        >
          {t('home')}
        </a>

        {category.breadcrumbs.map((crumb) => (
          <React.Fragment key={crumb.urlKey}>
            <ChevronRight size={12} className="text-slate-400" />
            <a
              href={getCatalogHref(crumb.urlKey, variantSlug)}
              onMouseEnter={() => prefetchHref(getCatalogHref(crumb.urlKey, variantSlug))}
              onFocus={() => prefetchHref(getCatalogHref(crumb.urlKey, variantSlug))}
              onClick={(event) =>
                handleCategoryLinkClick(
                  event,
                  getCatalogHref(crumb.urlKey, variantSlug)
                )
              }
              className="transition-colors hover:text-slate-900"
            >
              {getLocalizedCategoryName(crumb, locale)}
            </a>
          </React.Fragment>
        ))}

        <ChevronRight size={12} className="text-slate-400" />
        {extraCrumb ? (
          <>
            <a
              href={getCatalogHref(category.urlKey, variantSlug)}
              onMouseEnter={() => prefetchHref(getCatalogHref(category.urlKey, variantSlug))}
              onFocus={() => prefetchHref(getCatalogHref(category.urlKey, variantSlug))}
              onClick={(event) =>
                handleCategoryLinkClick(
                  event,
                  getCatalogHref(category.urlKey, variantSlug)
                )
              }
              className="transition-colors hover:text-slate-900"
            >
              {getLocalizedCategoryName(category, locale)}
            </a>
            <ChevronRight size={12} className="text-slate-400" />
            <span className="text-slate-900 font-medium">{extraCrumb}</span>
          </>
        ) : (
          <span className="text-slate-900 font-medium">{categoryName}</span>
        )}
      </nav>

      {showIntro && !vehicleString && (
        <p className="max-w-4xl text-[12px] leading-relaxed text-slate-500">
          {introText}
        </p>
      )}

      {/* vehicle info line */}
      {vehicleString && (
        <div className="flex items-center gap-3 text-[13px]">
          <p className="text-slate-900 font-medium">{vehicleString}</p>
          <div className="flex items-center gap-3 ml-1">
            <a
              href={getCatalogHref(category.urlKey)}
              className="text-[#0091D5]"
              onMouseEnter={() => prefetchHref(getCatalogHref(category.urlKey))}
              onFocus={() => prefetchHref(getCatalogHref(category.urlKey))}
              onClick={(event) =>
                handleCategoryLinkClick(event, getCatalogHref(category.urlKey))
              }
            >
              {tNavbar('edit')}
            </a>
            <a
              href={getCatalogHref(category.urlKey)}
              className="text-[#EF4444]"
              onMouseEnter={() => prefetchHref(getCatalogHref(category.urlKey))}
              onFocus={() => prefetchHref(getCatalogHref(category.urlKey))}
              onClick={(event) => {
                clearSelectedVehicle()
                handleCategoryLinkClick(event, getCatalogHref(category.urlKey))
              }}
            >
              {tNavbar('cancel')}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
