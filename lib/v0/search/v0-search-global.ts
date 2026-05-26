import 'server-only'
import { stripLeadingBrandPrefix } from '@/lib/product-display-name'
import { searchV0Catalog } from '@/lib/v0/search/v0-search-meili'

export type V0GlobalSearchBrand = {
  matchId: number
  brandName: string
  logoUrl: string | null
  type: 'brand'
}

export type V0GlobalSearchProduct = {
  id: number
  name: string
  brandName: string
  categoryName: string | null
  price: string | null
  image: string | null
  urlKey: string
  type: 'product'
}

export type V0GlobalSearchResults = {
  brands: V0GlobalSearchBrand[]
  products: V0GlobalSearchProduct[]
}

export async function searchV0Global(query: string): Promise<V0GlobalSearchResults> {
  if (!query || query.trim().length < 2) {
    return { brands: [], products: [] }
  }

  const result = await searchV0Catalog({
    query: query.trim(),
    page: 1,
    limit: 8
  })

  return {
    brands: result.brands.slice(0, 5).map((brand) => ({
      matchId: brand.matchId,
      brandName: brand.brandName,
      logoUrl: brand.logoUrl,
      type: 'brand' as const
    })),
    products: result.products.slice(0, 5).map((row) => {
      const brandName =
        row.dinamikBrand?.trim() ||
        row.ptManufacturerName?.trim() ||
        'Unknown'
      const rawName =
        row.ptTitle?.trim() ||
        row.dinamikStockName?.trim() ||
        row.dinamikStockCode?.trim() ||
        'Product'
      return {
      id: row.matchId,
      name: stripLeadingBrandPrefix(rawName, brandName),
      brandName,
      categoryName: null,
      price: row.ptPrice ?? row.dinamikPrice,
      image: row.ptImageUrl,
      urlKey: String(row.matchId),
      type: 'product' as const
      }
    })
  }
}
