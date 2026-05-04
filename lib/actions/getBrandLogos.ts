'use server'

import { db } from '@/lib/db'

/**
 * Fetch logo_url for given brand IDs from part_brands (same source as part detail page).
 * Returns a map of brandId -> logoUrl for use when merging with Meilisearch hits.
 */
export async function getBrandLogos(
  brandIds: number[]
): Promise<Record<number, string | null>> {
  if (brandIds.length === 0) return {}

  const brands = await db.part_brands.findMany({
    where: { id: { in: brandIds } },
    select: { id: true, logo_url: true }
  })

  return Object.fromEntries(brands.map((b) => [b.id, b.logo_url]))
}
