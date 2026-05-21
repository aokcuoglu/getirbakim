import { notFound } from 'next/navigation'
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query'
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
import { getCategoryProducts } from '@/lib/actions/getCategoryProducts'

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

  const initialProductsDehydratedState: ReturnType<typeof dehydrate> | undefined =
    shell.isLeaf
      ? await (async () => {
          const tProducts = tg.start('fetchInitialProducts')
          try {
            const productsResult = await getCategoryProducts({
              locale,
              slug: categorySlug,
              page: 1,
              limit: 24,
              sort: 'popularity'
            })

            const queryClient = new QueryClient()
            const serializedFilters = JSON.stringify({
              slug: categorySlug,
              ids: shell.category.searchIds,
              vid: null,
              brands: [],
              stock: [],
              page: 1,
              limit: 24,
              sort: 'popularity',
              minPrice: undefined,
              maxPrice: undefined
            })

            await queryClient.prefetchQuery({
              queryKey: ['category-products', serializedFilters],
              queryFn: () => Promise.resolve({
                hits: productsResult.products,
                totalHits: productsResult.totalEstimate,
                brandFacetDistribution: productsResult.brandFacetDistribution,
                stockFacetDistribution: productsResult.stockFacetDistribution,
                page: productsResult.page,
                limit: productsResult.limit,
                hasMore: productsResult.hasMore
              }),
              staleTime: 60 * 1000
            })

            tg.end(tProducts)
            return dehydrate(queryClient)
          } catch (error) {
            console.warn(
              `[renderCategoryPage] Failed to prefetch initial products for ${categorySlug}:`,
              error instanceof Error ? error.message : error
            )
            tg.end(tProducts)
            return undefined
          }
        })()
      : undefined

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
      {initialProductsDehydratedState ? (
        <HydrationBoundary state={initialProductsDehydratedState}>
          <CategoryPageShell shellPayload={shell} />
        </HydrationBoundary>
      ) : (
        <CategoryPageShell shellPayload={shell} />
      )}
    </>
  )
}