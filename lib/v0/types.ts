import type { CatalogData } from '@/lib/actions/getCatalogCategories'
import type { MainNavCategoryItem } from '@/lib/mainNavCategories'
import type { TopCategoryItem } from '@/components/hero/TopCategories'

export type V0DpmatchProductRow = {
  matchId: number
  dnprdId: string | null
  ptprdId: number | null
  mappingStatus: string
  matchMethod: string | null
  normalized_name: string | null
  dinamikStockCode: string | null
  dinamikStockName: string | null
  dinamikBrand: string | null
  dinamikPartNo: string | null
  dinamikBarcode1: string | null
  dinamikBarcode2: string | null
  dinamikBarcode3: string | null
  dinamikPrice: string | null
  dinamikStockQty: number | null
  ptTitle: string | null
  ptModel: string | null
  ptRefNo: string | null
  ptPrice: string | null
  ptImageUrl: string | null
  ptUrl: string | null
  ptManufacturerName: string | null
  /** Canonical brand from v0.dnmk_ptdrk_brand_mappings when approved. */
  matchedBrandName?: string | null
  brandLogoUrl: string | null
}

export type V0BrandMatchRow = {
  matchId: number
  dnbrdId: string | null
  /** All Dinamik brand ids in this normalized group (for product queries). */
  dnbrdIds: string[]
  ptbrdId: number | null
  brandName: string
  ptUrlKey: string | null
  logoUrl: string | null
  slug: string
}

/** Slim brand shape for homepage slider — avoids shipping query-only fields in RSC payload. */
export type V0HomeBrandItem = Pick<
  V0BrandMatchRow,
  'matchId' | 'brandName' | 'logoUrl' | 'slug'
>

export type V0HomePageData = {
  topCategories: TopCategoryItem[]
  navbarCategories: MainNavCategoryItem[]
  catalogData: CatalogData
  brands: V0HomeBrandItem[]
}
