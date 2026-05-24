'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'

import Navbar from '@/components/Navbar'
import Hero from '@/components/Hero'
import Footer from '@/components/Footer'
import type { MainNavCategoryItem } from '@/lib/mainNavCategories'
import type { TopCategoryItem } from '@/components/hero/TopCategories'
import type { CatalogData } from '@/lib/actions/getCatalogCategories'
import type { PopularManufacturer } from '@/lib/actions/getPopularManufacturers'
import { buildCatalogUrl } from '@/lib/catalog-url'

interface HomePageClientProps {
  topCategories: TopCategoryItem[]
  navbarCategories: MainNavCategoryItem[]
  catalogData: CatalogData
  manufacturers: PopularManufacturer[]
}

export default function HomePageClient({
  topCategories,
  navbarCategories,
  catalogData,
  manufacturers
}: HomePageClientProps) {
  const router = useRouter()
  const locale = useLocale()

  const onMakeSelect = (m: string) => {
    router.push(
      buildCatalogUrl(locale, {
        categoryUrlKey: 'car-parts',
        searchParams: { make: m }
      })
    )
  }

  const onBrandSelect = (b: string) => {
    router.push(
      buildCatalogUrl(locale, {
        categoryUrlKey: 'car-parts',
        searchParams: { brand: b }
      })
    )
  }

  return (
    <div className="min-h-screen text-foreground selection:bg-accent/20 flex flex-col">
      <Navbar
        navbarCategories={navbarCategories}
        onHomeClick={() => router.push('/')}
      />

      <main className="flex-1 pb-16">
        <Hero
          topCategories={topCategories}
          catalogData={catalogData}
          manufacturers={manufacturers}
          onMakeSelect={onMakeSelect}
          onBrandSelect={onBrandSelect}
        />
      </main>

      <Footer onAdminClick={() => router.push('/admin')} />
    </div>
  )
}
