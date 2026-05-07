import { getMainNavCategories } from '@/lib/mainNavCategories'
import { getCatalogData } from '@/lib/actions/getCatalogCategories'
import { getPopularManufacturers } from '@/lib/actions/getPopularManufacturers'
import HomePageClient from './HomePageClient'
import type { TopCategoryItem } from '@/components/hero/TopCategories'
import type { Metadata } from 'next'
import {
  buildLocaleAlternates,
  defaultRobotsIndexing
} from '@/lib/seo/url'
import { createTimerGroup } from '@/lib/performance/timing'

interface PageProps {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params

  return {
    title: 'GetirBakim - Automotive Commerce',
    description: 'The modern platform for automotive parts.',
    alternates: buildLocaleAlternates(locale, '/'),
    robots: defaultRobotsIndexing()
  }
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params
  const tg = createTimerGroup('homepage')
  const tCatalog = tg.start('catalogData')
  const tMfrs = tg.start('manufacturers')
  const tNav = tg.start('mainNav')

  const [catalogData, manufacturers, mainNav] = await Promise.all([
    getCatalogData(locale).then((d) => { tg.end(tCatalog); return d }),
    getPopularManufacturers().then((d) => { tg.end(tMfrs); return d }),
    getMainNavCategories(locale).then((d) => { tg.end(tNav); return d })
  ])
  tg.logSummary()

  const topCategories: TopCategoryItem[] = mainNav
    .filter(
      (c): c is typeof c & { urlKey: string } =>
        typeof c.urlKey === 'string' && c.urlKey.length > 0
    )
    .map((c) => ({
      id: c.id,
      name: c.name,
      urlKey: c.urlKey,
      image: c.image ?? null
    }))
  const navbarCategories = mainNav

  return (
    <HomePageClient
      topCategories={topCategories}
      navbarCategories={navbarCategories}
      catalogData={catalogData}
      manufacturers={manufacturers}
    />
  )
}
