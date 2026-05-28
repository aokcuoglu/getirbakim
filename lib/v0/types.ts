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
  matchedBrandName?: string | null
  brandLogoUrl: string | null
}

export type V0BrandMatchRow = {
  matchId: number
  dbrandsId: string | null
  dbrandsIds: string[]
  ptbrandsId: number | null
  brandName: string
  ptUrlKey: string | null
  logoUrl: string | null
  slug: string
}

export type V0HomeBrandItem = Pick<
  V0BrandMatchRow,
  'matchId' | 'brandName' | 'logoUrl' | 'slug'
>

export type V0HomePageData = {
  brands: V0HomeBrandItem[]
}
