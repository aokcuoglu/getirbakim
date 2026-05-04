import { redirect, notFound } from 'next/navigation'
import { getCategoryByUrlKey } from '@/lib/actions/getPartCategories'
import {
  getSearchParamValue,
  resolveDefaultCategorySlug,
  type CategoryRouteSearchParams
} from '../_lib/category-page-data'
import { buildCategoryUrl } from '@/lib/catalog-url'

interface CatalogPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CatalogPage({
  params,
  searchParams
}: CatalogPageProps) {
  const { locale } = await params
  const resolvedSearchParams = (await searchParams) as CategoryRouteSearchParams

  const rawCategorySlug = getSearchParamValue(resolvedSearchParams, 'cat')
  const categorySlug = rawCategorySlug ?? (await resolveDefaultCategorySlug(locale))
  const category = await getCategoryByUrlKey(categorySlug)
  if (!category?.urlKey) {
    notFound()
  }

  const canonicalSearchParams: Record<string, string> = {}
  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    if (!value || key === 'cat' || key === 'variant') return

    if (Array.isArray(value)) {
      if (value[0]) {
        canonicalSearchParams[key] = value[0]
      }
      return
    }

    canonicalSearchParams[key] = value
  })

  const variantSlug = getSearchParamValue(resolvedSearchParams, 'variant')
  redirect(
    buildCategoryUrl(locale, {
      categoryUrlKey: category.urlKey,
      variantSlug: variantSlug ?? null,
      searchParams: canonicalSearchParams
    })
  )
}
