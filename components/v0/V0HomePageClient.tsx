'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'

import Navbar from '@/components/Navbar'
import Hero from '@/components/Hero'
import Footer from '@/components/Footer'
import type { V0HomePageData } from '@/lib/v0/types'
import { buildCatalogUrl } from '@/lib/catalog-url'

export default function V0HomePageClient({
  brands
}: V0HomePageData) {
  const router = useRouter()
  const locale = useLocale()

  const onMakeSelect = (make: string) => {
    router.push(
      buildCatalogUrl(locale, {
        categoryUrlKey: 'car-parts',
        searchParams: { make }
      })
    )
  }

  return (
    <div className="min-h-screen text-foreground selection:bg-accent/20 flex flex-col">
      <Navbar onHomeClick={() => router.push('/')} />

      <main className="flex-1 pb-16">
        <Hero
          brands={brands}
          onMakeSelect={onMakeSelect}
        />
      </main>

      <Footer onAdminClick={() => router.push('/admin')} />
    </div>
  )
}
