import { getV0HomePageData } from '@/lib/v0/getHomePageData'
import V0HomePageClient from '@/components/v0/V0HomePageClient'
import type { Metadata } from 'next'
import {
  buildLocaleAlternates,
  defaultRobotsIndexing
} from '@/lib/seo/url'
import { createTimerGroup } from '@/lib/performance/timing'

interface PageProps {
  params: Promise<{ locale: string }>
}

const HOME_TITLE: Record<string, string> = {
  tr: 'GetirBakim - Otomotiv Yedek Parca',
  en: 'GetirBakim - Automotive Spare Parts'
}

const HOME_DESCRIPTION: Record<string, string> = {
  tr: 'Turkiye\'nin otomotiv yedek parca platformu. Binlerce marka ve model icin orijinal ve muadil yedek parca, hizli teslimat ve uygun fiyatlar.',
  en: 'Turkey\'s automotive spare parts platform. Original and aftermarket parts for thousands of makes and models, fast delivery and competitive prices.'
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const safeLocale = locale === 'tr' ? 'tr' : 'en'

  return {
    title: HOME_TITLE[safeLocale],
    description: HOME_DESCRIPTION[safeLocale],
    alternates: buildLocaleAlternates(locale, '/'),
    robots: defaultRobotsIndexing()
  }
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params
  const tg = createTimerGroup('homepage-v0')
  const tData = tg.start('v0HomePageData')

  const homePageData = await getV0HomePageData(locale).then((data) => {
    tg.end(tData, { brandCount: data.brands.length })
    return data
  })
  tg.logSummary()

  return <V0HomePageClient {...homePageData} />
}
