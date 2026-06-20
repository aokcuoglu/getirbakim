export type V0BrandMatchRow = {
  matchId: number
  dnbrdId: string | null
  dnbrdIds: string[]
  ptbrdId: number | null
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