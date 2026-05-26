'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { PartFinder } from './PartFinder'
import { TopCategories, TopCategoryItem } from './hero/TopCategories'
import { CampaignCarousel } from './hero/CampaignCarousel'
import { CatalogSection } from './hero/CatalogSection'
import { PopularMakes } from './hero/PopularMakes'
import { PopularManufacturers } from './hero/PopularManufacturers'
import { HeroBrandsSlider } from '@/components/v0/HeroBrandsSlider'
import type { CatalogData } from '@/lib/actions/getCatalogCategories'
import type { PopularManufacturer } from '@/lib/actions/getPopularManufacturers'
import type { V0BrandMatchRow } from '@/lib/v0/types'
import { useShop } from '@/components/ShopProvider'
import { buildCatalogUrl } from '@/lib/catalog-url'
import { SoonFeature } from '@/components/ui/SoonFeature'
import { isV0OnlySite } from '@/lib/v0/siteMode'

interface HeroProps {
  topCategories: TopCategoryItem[]
  catalogData: CatalogData
  manufacturers?: PopularManufacturer[]
  brands?: V0BrandMatchRow[]
  onMakeSelect?: (make: string) => void
  onBrandSelect?: (brand: string) => void
}

const Hero: React.FC<HeroProps> = ({
  topCategories,
  catalogData,
  manufacturers = [],
  brands,
  onMakeSelect,
  onBrandSelect
}) => {
  const router = useRouter()
  const locale = useLocale()
  const { selectedVehicle } = useShop()
  const v0OnlySite = isV0OnlySite()

  const handleCategoryClick = (cat: TopCategoryItem) => {
    const selectedVehicleUrlKey = (selectedVehicle as any)?.urlKey
    const url = buildCatalogUrl(locale, {
      categoryUrlKey: cat.urlKey,
      variantSlug: selectedVehicleUrlKey ?? null
    })
    router.push(url)
  }

  return (
    <div className="w-full bg-background">
      {/* 1. Hero Section (Vehicle + Intro) */}
      <PartFinder />

      {/* 2. Top Category Images - from DB where is_top_category=true */}
      <SoonFeature enabled={v0OnlySite} className="min-h-[7.5rem]">
        <TopCategories
          categories={topCategories}
          onCategoryClick={handleCategoryClick}
        />
      </SoonFeature>

      {/* 3. Campaign Carousel */}
      <SoonFeature enabled={v0OnlySite}>
        <CampaignCarousel />
      </SoonFeature>

      {/* 4. Subcategory Catalog Grid */}
      <SoonFeature enabled={v0OnlySite} className="min-h-[min(60vh,28rem)]">
        <CatalogSection catalogData={catalogData} />
      </SoonFeature>

      {/* 5. Popular Vehicle Makes */}
      <SoonFeature enabled={v0OnlySite}>
        <PopularMakes onMakeSelect={onMakeSelect} />
      </SoonFeature>

      {/* 6. Brands (v0) or Popular Manufacturers (legacy) */}
      {brands && brands.length > 0 ? (
        <HeroBrandsSlider brands={brands} />
      ) : (
        <PopularManufacturers
          manufacturers={manufacturers}
          onBrandSelect={onBrandSelect}
        />
      )}
    </div>
  )
}

export default Hero
