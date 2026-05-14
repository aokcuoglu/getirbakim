import { notFound } from 'next/navigation'
import { CategoryPageShell } from '../[...slug]/_components/CategoryPageShell'
import {
  buildCategoryShellPayload,
  fetchLeafInitialData,
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
  const shell = await buildCategoryShellPayload({
    locale,
    categorySlug,
    searchParams,
    preResolvedCategory
  })

  if (!shell) {
    notFound()
  }

  const breadcrumbJsonLd = buildCategoryBreadcrumbJsonLd(locale, shell.category)
  const itemListJsonLd = buildCategoryItemListJsonLd(locale, shell.category)

  const initialData = shell.isLeaf
    ? await fetchLeafInitialData(
        shell.category.name,
        shell.category.searchIds,
        shell.resolvedVehicleId,
        searchParams
      )
    : undefined

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
      <CategoryPageShell
        shellPayload={shell}
        initialData={initialData}
      />
    </>
  )
}
