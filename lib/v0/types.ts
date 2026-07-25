export type V0BrandMatchRow = {
  matchId: number
  dnbrdId: string | null
  dnbrdIds: string[]
  brandName: string
  logoUrl: string | null
  slug: string
  brandListIds: number[]
}

export type V0HomeBrandItem = Pick<
  V0BrandMatchRow,
  'matchId' | 'brandName' | 'logoUrl' | 'slug'
>

export type V0HomePageData = {
  brands: V0HomeBrandItem[]
}