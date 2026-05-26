import { BrandProductsClientWrapper } from './BrandProductsClientWrapper'
import { getDpmatchProductsByBrandPage } from '@/lib/v0/getDpmatchProductsByBrand'
import { mapDpmatchRowsToSearchHits } from '@/lib/v0/mapDpmatchToSearchHit'
import type { BrandPageFilters } from '@/lib/v0/brandPageFilters'
import type { V0BrandMatchRow } from '@/lib/v0/types'
import { createTimerGroup } from '@/lib/performance/timing'

interface BrandProductsSectionProps {
  brand: V0BrandMatchRow
  locale: string
  filters: BrandPageFilters
}

export async function BrandProductsSection({
  brand,
  locale,
  filters
}: BrandProductsSectionProps) {
  const tg = createTimerGroup('brandPageProducts')
  const tProducts = tg.start('dpmatchProductsByBrand')

  const productsPage = await getDpmatchProductsByBrandPage(
    {
      dbrandsIds: brand.dbrandsIds,
      ptbrandsId: brand.ptbrandsId
    },
    filters
  )

  tg.end(tProducts, {
    page: productsPage.page,
    count: productsPage.products.length,
    totalCount: productsPage.totalCount,
    hasNextPage: productsPage.hasNextPage
  })
  tg.logSummary()

  const products = mapDpmatchRowsToSearchHits(productsPage.products)

  return (
    <BrandProductsClientWrapper
      brand={brand}
      locale={locale}
      filters={filters}
      products={products}
      totalCount={productsPage.totalCount}
      totalPages={productsPage.totalPages}
      stockFacetDistribution={productsPage.stockFacetDistribution}
    />
  )
}
