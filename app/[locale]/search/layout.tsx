import { ReactNode } from 'react'
import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { getMainNavCategories } from '@/lib/mainNavCategories'
import { SearchHero } from './_components/SearchHero'
import { buildLocaleAlternates, defaultRobotsIndexing } from '@/lib/seo/url'

interface SearchLayoutProps {
  children: ReactNode
  params: Promise<{
    locale: string
  }>
}

export async function generateMetadata({
  params
}: SearchLayoutProps): Promise<Metadata> {
  const { locale } = await params

  return {
    title: locale === 'tr' ? 'Parca Ara | GetirBakim' : 'Search Parts | GetirBakim',
    description:
      locale === 'tr'
        ? 'OEM numarasi, parca adi veya arac modeli ile arama yapin.'
        : 'Search by OEM number, part name, or vehicle model.',
    alternates: buildLocaleAlternates(locale, '/search'),
    robots: defaultRobotsIndexing()
  }
}

export default async function SearchLayout({
  children,
  params
}: SearchLayoutProps) {
  const { locale } = await params

  const navbarCategories = await getMainNavCategories(locale)

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      {/* Navbar */}
      <Navbar navbarCategories={navbarCategories} />

      {/* Main Content */}
      <main className="flex-1">
        {/* Search Hero with Vehicle Selector */}
        <SearchHero />

        {children}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  )
}
