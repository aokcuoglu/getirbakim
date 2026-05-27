import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { SafeImage } from '@/components/ui/SafeImage'
import { BrandProductsSection } from './_components/BrandProductsSection'
import { BrandPageProductsSkeleton } from './_components/BrandPageProductsSkeleton'
import { getDbrandsMatchBySlug } from '@/lib/v0/getDbrandsMatch'
import { buildBrandPath } from '@/lib/v0/brandSlug'
import { parseBrandPageFilters } from '@/lib/v0/brandPageFilters'
import { buildLocaleAlternates, defaultRobotsIndexing } from '@/lib/seo/url'
import { getTranslations } from 'next-intl/server'
import { createTimerGroup } from '@/lib/performance/timing'

interface BrandPageProps {
  params: Promise<{
    locale: string
    slug: string
  }>
  searchParams: Promise<{
    page?: string
    limit?: string
    sort?: string
    stock?: string
    minPrice?: string
    maxPrice?: string
  }>
}

export const revalidate = 300

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const { slug, locale } = await params
  const brand = await getDbrandsMatchBySlug(slug)

  if (!brand) {
    return { title: 'Brand Not Found' }
  }

  const safeLocale = locale === 'tr' ? 'tr' : 'en'
  const title =
    safeLocale === 'tr'
      ? `${brand.brandName} Yedek Parçalar | GetirBakim`
      : `${brand.brandName} Spare Parts | GetirBakim`
  const description =
    safeLocale === 'tr'
      ? `${brand.brandName} markasına ait yedek parçaları keşfedin.`
      : `Browse spare parts from ${brand.brandName}.`

  return {
    title,
    description,
    alternates: buildLocaleAlternates(locale, buildBrandPath(brand.slug)),
    robots: defaultRobotsIndexing()
  }
}

export default async function BrandPage({ params, searchParams }: BrandPageProps) {
  const { locale, slug } = await params
  const resolvedSearchParams = await searchParams
  const filters = parseBrandPageFilters(resolvedSearchParams)

  const tg = createTimerGroup('brandPage')
  const tShell = tg.start('shell')

  const [brand, t] = await Promise.all([
    getDbrandsMatchBySlug(slug),
    getTranslations('V0Home')
  ])

  if (!brand) {
    notFound()
  }

  tg.end(tShell, { brandMatchId: brand.matchId, page: filters.page })
  tg.logSummary()

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-3 pb-2">
        <nav className="mb-2 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Link href={`/${locale}`} className="transition-colors hover:text-foreground">
            {t('breadcrumbHome')}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-foreground">{brand.brandName}</span>
        </nav>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 pb-8">
        <div className="mb-4 border-b border-border pb-3">
          {brand.logoUrl ? (
            <>
              <h1 className="sr-only">{brand.brandName}</h1>
              <div className="flex h-14 w-[140px] shrink-0 items-center justify-center">
                <SafeImage
                  src={brand.logoUrl}
                  alt={brand.brandName}
                  width={140}
                  height={56}
                  className="max-h-14 w-auto max-w-full object-contain object-left"
                  fallback={
                    <span className="text-sm font-bold text-foreground">
                      {brand.brandName}
                    </span>
                  }
                />
              </div>
            </>
          ) : (
            <h1 className="text-xl font-semibold text-foreground">{brand.brandName}</h1>
          )}
        </div>

        <Suspense
          key={`${brand.slug}-${JSON.stringify(filters)}`}
          fallback={<BrandPageProductsSkeleton />}
        >
          <BrandProductsSection brand={brand} locale={locale} filters={filters} />
        </Suspense>
      </div>
    </>
  )
}
