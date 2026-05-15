import { notFound } from 'next/navigation'
import { CategoryPageShell } from '../[...slug]/_components/CategoryPageShell'
import {
  buildCategoryShellPayload,
  type CategoryRouteSearchParams
} from './category-page-data'
import type { TrodoCategoryWithHierarchy } from '@/lib/actions/getPartCategories'
import {
  buildCategoryBreadcrumbJsonLd,
  buildCategoryItemListJsonLd
} from '@/lib/seo/structured-data'
import { createTimerGroup } from '@/lib/performance/timing'

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
  const tg = createTimerGroup('renderCategoryPage')
  const tShell = tg.start('buildShell')

  const shell = await buildCategoryShellPayload({
    locale,
    categorySlug,
    searchParams,
    preResolvedCategory
  })

  if (!shell) {
    notFound()
  }

  tg.end(tShell)

  if (process.env.PERFORMANCE_LOGGING === 'true') {
    const totalMs = tg.getTotalMs()
    if (totalMs > 3000) {
      console.warn(
        `[LEAF_CATEGORY_STREAM_SLOW] categoryPage=${categorySlug} total=${totalMs}ms`
      )
    }
  }

  tg.logSummary()

  const breadcrumbJsonLd = buildCategoryBreadcrumbJsonLd(locale, shell.category)
  const itemListJsonLd = buildCategoryItemListJsonLd(locale, shell.category)

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
      />
    </>
  )
}