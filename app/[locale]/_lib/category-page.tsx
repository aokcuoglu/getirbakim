import { notFound } from 'next/navigation'
import { CategoryPageShell } from '../[...slug]/_components/CategoryPageShell'
import {
  buildCategoryPagePayload,
  type CategoryRouteSearchParams
} from './category-page-data'
import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import {
  buildCategoryBreadcrumbJsonLd,
  buildCategoryItemListJsonLd
} from '@/lib/seo/structured-data'

export async function renderCategoryPage({
  locale,
  categorySlug,
  searchParams,
  preResolvedCategory
}: {
  locale: string
  categorySlug: string
  searchParams: CategoryRouteSearchParams
  preResolvedCategory?: TrodoCategoryWithHierarchy
}) {
  const payload = await buildCategoryPagePayload({
    locale,
    categorySlug,
    searchParams,
    preResolvedCategory
  })

  if (!payload) {
    notFound()
  }

  const breadcrumbJsonLd = buildCategoryBreadcrumbJsonLd(locale, payload.category)
  const itemListJsonLd = buildCategoryItemListJsonLd(locale, payload.category)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {itemListJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
        />
      ) : null}
      <CategoryPageShell initialPayload={payload} />
    </>
  )
}
