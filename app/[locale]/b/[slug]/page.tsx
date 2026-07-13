import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SafeImage } from '@/components/ui/SafeImage'
import { getDbrandsMatchBySlug } from '@/lib/v0/getDbrandsMatch'
import { buildBrandPath } from '@/lib/v0/brandSlug'
import { getCatalogArticles, type SortOption } from '@/lib/actions/getCatalogArticles'
import { buildLocaleAlternates, defaultRobotsIndexing } from '@/lib/seo/url'
import { BrandProductsGrid } from './_components/BrandProductsGrid'

const PAGE_LIMIT = 24
const SORT_OPTIONS: SortOption[] = ['popularity', 'price-asc', 'price-desc', 'name']

interface BrandPageProps {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ page?: string; sort?: string }>
}

function parsePage(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function parseSort(raw: string | undefined): SortOption {
  return SORT_OPTIONS.includes(raw as SortOption) ? (raw as SortOption) : 'popularity'
}

export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const { slug, locale } = await params
  const brand = await getDbrandsMatchBySlug(slug)

  if (!brand) {
    return { title: 'Brand Not Found' }
  }

  const safeLocale = locale === 'tr' ? 'tr' : 'en'
  const title =
    safeLocale === 'tr'
      ? `${brand.brandName} Yedek Parçalar`
      : `${brand.brandName} Spare Parts`
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

export const revalidate = 300

export default async function BrandPage({ params, searchParams }: BrandPageProps) {
  const { locale, slug } = await params
  const { page: rawPage, sort: rawSort } = await searchParams

  const brand = await getDbrandsMatchBySlug(slug)
  if (!brand) {
    notFound()
  }

  const page = parsePage(rawPage)
  const sort = parseSort(rawSort)
  const t = await getTranslations('V0Home')

  const articles =
    brand.brandListIds.length > 0
      ? await getCatalogArticles({
          brandListIds: brand.brandListIds,
          page,
          limit: PAGE_LIMIT,
          sort,
          includeTotal: true
        })
      : null

  const totalHits = articles?.totalHits ?? 0
  const totalPages = Math.max(1, Math.ceil(totalHits / PAGE_LIMIT))

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

        <BrandProductsGrid
          hits={articles?.hits ?? []}
          totalHits={totalHits}
          page={page}
          totalPages={totalPages}
          limit={PAGE_LIMIT}
          locale={locale}
          brandName={brand.brandName}
        />
      </div>
    </>
  )
}
