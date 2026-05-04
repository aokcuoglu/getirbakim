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
import type { CatalogData } from '@/lib/actions/getCatalogCategories'
import type { PopularManufacturer } from '@/lib/actions/getPopularManufacturers'
import { useShop } from '@/components/ShopProvider'
import { buildCatalogUrl } from '@/lib/catalog-url'

interface HeroProps {
  topCategories: TopCategoryItem[]
  catalogData: CatalogData
  manufacturers: PopularManufacturer[]
  onMakeSelect?: (make: string) => void
  onBrandSelect?: (brand: string) => void
}

const Hero: React.FC<HeroProps> = ({
  topCategories,
  catalogData,
  manufacturers,
  onMakeSelect,
  onBrandSelect
}) => {
  const router = useRouter()
  const locale = useLocale()
  const { selectedVehicle } = useShop()

  const handleCategoryClick = (cat: TopCategoryItem) => {
    const selectedVehicleUrlKey = (selectedVehicle as any)?.urlKey
    const url = buildCatalogUrl(locale, {
      categoryUrlKey: cat.urlKey,
      variantSlug: selectedVehicleUrlKey ?? null
    })
    router.push(url)
  }

  return (
    <div className="w-full bg-white">
      {/* 1. Hero Section (Vehicle + Intro) */}
      <PartFinder />

      {/* 2. Top Category Images - from DB where is_top_category=true */}
      <TopCategories
        categories={topCategories}
        onCategoryClick={handleCategoryClick}
      />

      {/* 3. Campaign Carousel */}
      <CampaignCarousel />

      {/* 4. Subcategory Catalog Grid */}
      <CatalogSection catalogData={catalogData} />

      {/* 5. Popular Vehicle Makes */}
      <PopularMakes onMakeSelect={onMakeSelect} />

      {/* 6. Popular Manufacturers */}
      <PopularManufacturers
        manufacturers={manufacturers}
        onBrandSelect={onBrandSelect}
      />
    </div>
  )
}

export default Hero
