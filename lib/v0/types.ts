import type { CatalogData } from '@/lib/actions/getCatalogCategories'
import type { MainNavCategoryItem } from '@/lib/mainNavCategories'
import type { TopCategoryItem } from '@/components/hero/TopCategories'

export type V0DpmatchProductRow = {
  matchId: number
  dproductsId: string | null
  ptproductsId: number | null
  mappingStatus: string
  matchMethod: string | null
  normalized: string | null
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
  brandLogoUrl: string | null
}

export type V0BrandMatchRow = {
  matchId: number
  dbrandsId: string | null
  /** All Dinamik brand ids in this normalized group (for product queries). */
  dbrandsIds: string[]
  ptbrandsId: number | null
  brandName: string
  ptUrlKey: string | null
  logoUrl: string | null
}

export type V0HomePageData = {
  topCategories: TopCategoryItem[]
  navbarCategories: MainNavCategoryItem[]
  catalogData: CatalogData
  brands: V0BrandMatchRow[]
}
