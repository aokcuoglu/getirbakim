import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCategoryByUrlKey } from '@/lib/actions/getPartCategories'
import { buildCategoryUrl } from '@/lib/catalog-url'
import { renderCategoryPage } from '../_lib/category-page'
import {
  getSearchParamValue,
  type CategoryRouteSearchParams
} from '../_lib/category-page-data'
import { getLocalizedCategoryName } from '@/lib/utils/category-localization'
import { buildLocaleAlternates, defaultRobotsIndexing } from '@/lib/seo/url'
import { createTimerGroup } from '@/lib/performance/timing'

interface LegacyCategoryPageProps {
  params: Promise<{
    locale: string
    slug: string[]
  }>
  searchParams: Promise<Record<string, string | string[]>>
}

export const revalidate = 3600

export async function generateMetadata({
  params
}: LegacyCategoryPageProps): Promise<Metadata> {
  const { locale, slug } = await params
  const urlKey = slug[0]

  if (!urlKey) {
    notFound()
  }

  const category = await getCategoryByUrlKey(urlKey)
  if (!category?.urlKey) {
    notFound()
  }

  const categoryName = getLocalizedCategoryName(category, locale)

  return {
    title: `${categoryName} | GetirBakim`,
    description:
      locale === 'tr'
        ? `${categoryName} kategorisinde uyumlu urunleri inceleyin, alt kategorilerde hizli gezinin ve markalari karsilastirin.`
        : `Browse compatible products in ${categoryName}. Navigate subcategories quickly and compare brands.`,
    alternates: buildLocaleAlternates(locale, `/${category.urlKey}`),
    robots: defaultRobotsIndexing()
  }
}

export default async function LegacyCategoryPage({
  params,
  searchParams
}: LegacyCategoryPageProps) {
  const tg = createTimerGroup('categoryPage')
  const tStart = tg.start('resolve')

  const { locale, slug } = await params
  const resolvedSearchParams = (await searchParams) as CategoryRouteSearchParams

  const urlKey = slug[0]
  const variantSlug = slug.length > 1 ? slug.slice(1).join('/') : undefined

  if (!urlKey) {
    notFound()
  }

  const category = await getCategoryByUrlKey(urlKey)
  if (!category?.urlKey) {
    notFound()
  }

  if (slug.length > 1 || urlKey !== category.urlKey) {
    const canonicalSearchParams: Record<string, string> = {}

    for (const [key, rawValue] of Object.entries(resolvedSearchParams)) {
      if (!rawValue || key === 'cat' || key === 'variant') continue

      if (Array.isArray(rawValue)) {
        if (rawValue.length === 0 || !rawValue[0]) continue
        canonicalSearchParams[key] = rawValue[0]
        continue
      }

      canonicalSearchParams[key] = rawValue
    }

    redirect(
      buildCategoryUrl(locale, {
        categoryUrlKey: category.urlKey,
        variantSlug:
          variantSlug ?? getSearchParamValue(resolvedSearchParams, 'variant') ?? null,
        searchParams: canonicalSearchParams
      })
    )
  }

  tg.end(tStart)

  return renderCategoryPage({
    locale,
    categorySlug: category.urlKey,
    searchParams: resolvedSearchParams,
    preResolvedCategory: category
  })
}
