import { getApprovedDbrandsMatch } from '@/lib/v0/getDbrandsMatch'
import type { V0HomePageData } from '@/lib/v0/types'

export async function getV0HomePageData(): Promise<V0HomePageData> {
  const brands = await getApprovedDbrandsMatch()

  return {
    brands: brands.map(({ matchId, brandName, logoUrl, slug }) => ({
      matchId,
      brandName,
      logoUrl,
      slug
    }))
  }
}
