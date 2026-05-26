import { getCatalogData } from '@/lib/actions/getCatalogCategories'
import { getMainNavCategories } from '@/lib/mainNavCategories'
import type { TopCategoryItem } from '@/components/hero/TopCategories'
import { getApprovedDbrandsMatch } from '@/lib/v0/getDbrandsMatch'
import type { V0HomePageData } from '@/lib/v0/types'

export async function getV0HomePageData(locale: string): Promise<V0HomePageData> {
  const [catalogData, mainNav, brands] = await Promise.all([
    getCatalogData(locale),
    getMainNavCategories(locale),
    getApprovedDbrandsMatch()
  ])

  const topCategories: TopCategoryItem[] = mainNav
    .filter(
      (category): category is typeof category & { urlKey: string } =>
        typeof category.urlKey === 'string' && category.urlKey.length > 0
    )
    .map((category) => ({
      id: category.id,
      name: category.name,
      urlKey: category.urlKey,
      image: category.image ?? null
    }))

  return {
    topCategories,
    navbarCategories: mainNav,
    catalogData,
    brands: brands.map(({ matchId, brandName, logoUrl, slug }) => ({
      matchId,
      brandName,
      logoUrl,
      slug
    }))
  }
}
